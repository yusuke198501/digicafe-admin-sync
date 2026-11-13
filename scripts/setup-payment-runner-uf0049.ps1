# Run once in an administrator PowerShell on UF-0049. No passwords are saved here.
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'UF-0049') { throw 'Run this script on UF-0049 only.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open PowerShell as Administrator.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  winget install --id GitHub.cli --exact --source winget
  if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI installation failed.' }
  $env:Path = (Join-Path $env:ProgramFiles 'GitHub CLI') + ';' + $env:Path
}
gh api repos/yusuke198501/digicafe-admin-sync --jq '.permissions.admin' | Tee-Object -Variable repositoryAdmin | Out-Null
if ($LASTEXITCODE -ne 0 -or $repositoryAdmin -ne 'true') {
  Write-Host 'Sign in to GitHub as yusuke198501 in the browser.'
  gh auth login --hostname github.com --web --git-protocol https --scopes repo,workflow
  if ($LASTEXITCODE -ne 0) { throw 'GitHub sign-in was not completed.' }
  $repositoryAdmin = gh api repos/yusuke198501/digicafe-admin-sync --jq '.permissions.admin'
  if ($LASTEXITCODE -ne 0 -or $repositoryAdmin -ne 'true') { throw 'The signed-in GitHub account needs repository administrator access.' }
}
$runnerRoot = 'C:\actions-runner-digicafe-payment'
New-Item -ItemType Directory -Path $runnerRoot -Force | Out-Null
Push-Location $runnerRoot
try {
  if (-not (Test-Path -LiteralPath '.runner')) {
    # Official actions/runner release and GitHub-published SHA-256 digest.
    $release = gh api repos/actions/runner/releases/latest | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the official runner release.' }
    $asset = @($release.assets | Where-Object { $_.name -match '^actions-runner-win-x64-[\d.]+\.zip$' })
    if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Official runner checksum unavailable; installation stopped.' }
    $zipPath = Join-Path $runnerRoot $asset[0].name
    Invoke-WebRequest -Uri $asset[0].browser_download_url -OutFile $zipPath -UseBasicParsing
    $expected = $asset[0].digest.Substring(7)
    if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Runner SHA-256 mismatch.' }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $runnerRoot -Force
    $registration = gh api --method POST repos/yusuke198501/digicafe-admin-sync/actions/runners/registration-token | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $registration.token) { throw 'Could not register the runner.' }
    try {
      & .\config.cmd --unattended --url https://github.com/yusuke198501/digicafe-admin-sync --token $registration.token --name UF-0049 --labels UF-0049 --work _work --runasservice --windowslogonaccount 'NT AUTHORITY\NETWORK SERVICE'
      if ($LASTEXITCODE -ne 0) { throw 'Runner registration failed.' }
    } finally { $registration = $null }
  }
  $service = Get-Service | Where-Object { $_.Name -like 'actions.runner.*UF-0049*' }
  if (@($service).Count -ne 1) { throw 'Runner service was not found uniquely.' }
  if ($service.Status -ne 'Running') { Start-Service -Name $service.Name }
  Start-Sleep -Seconds 3
  $runners = gh api repos/yusuke198501/digicafe-admin-sync/actions/runners | ConvertFrom-Json
  $runner = @($runners.runners | Where-Object { $_.name -eq 'UF-0049' -and $_.status -eq 'online' })
  if ($runner.Count -ne 1) { throw 'Runner is not online yet. Wait briefly, then run this script again.' }
  gh variable set PAYMENT_RUNNER_ENABLED --repo yusuke198501/digicafe-admin-sync --body true
  if ($LASTEXITCODE -ne 0) { throw 'Could not enable payment routing.' }
  gh workflow run payment-points-sync.yml --repo yusuke198501/digicafe-admin-sync --ref main --field probe=true
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the read-only payment test.' }
  Write-Host 'UF-0049 runner is online. Payment-only routing is enabled and a read-only test has started.'
} finally { Pop-Location }
