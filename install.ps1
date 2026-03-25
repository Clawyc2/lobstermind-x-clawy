# 🦞 LobsterMind Memory - Quick Install Script (Windows PowerShell)
# For Windows 10/11

Write-Host "🦞 LobsterMind Memory - Installing..." -ForegroundColor Cyan

# Check for Node.js
try {
    $nodeVersion = node -v
    $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    
    if ($versionNumber -lt 22) {
        Write-Host "❌ Node.js 22 or higher is required. You have: $nodeVersion" -ForegroundColor Red
        Write-Host "   Install from: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "✅ Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is required but not installed." -ForegroundColor Red
    Write-Host "   Install from: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check for OpenClaw
try {
    $openclawVersion = openclaw --version
    Write-Host "✅ OpenClaw installed: $openclawVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ OpenClaw is not installed." -ForegroundColor Red
    Write-Host "   Install with: npm install -g openclaw@latest" -ForegroundColor Yellow
    exit 1
}

# Set up extensions directory
$OpenClawExt = "$env:USERPROFILE\.openclaw\extensions\lobstermind-memory"

if (Test-Path $OpenClawExt) {
    Write-Host "⚠️  Plugin already exists at $OpenClawExt" -ForegroundColor Yellow
    $response = Read-Host "Do you want to reinstall? (y/N)"
    if ($response -notmatch '^[Yy]$') {
        Write-Host "Installation cancelled." -ForegroundColor Yellow
        exit 0
    }
    Remove-Item -Recurse -Force $OpenClawExt
}

# Clone repository
Write-Host "📦 Cloning repository..." -ForegroundColor Cyan
git clone https://github.com/pnll1991/lobstermind-memory.git $OpenClawExt

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Cyan
Set-Location $OpenClawExt
npm install

# Update openclaw.json
Write-Host "⚙️  Updating OpenClaw configuration..." -ForegroundColor Cyan
$ConfigFile = "$env:USERPROFILE\.openclaw\openclaw.json"

if (-not (Test-Path $ConfigFile)) {
    Write-Host "❌ OpenClaw configuration not found at $ConfigFile" -ForegroundColor Red
    Write-Host "   Run 'openclaw onboard' first to initialize OpenClaw." -ForegroundColor Yellow
    exit 1
}

# Backup config
Copy-Item $ConfigFile "$ConfigFile.bak"

# Read and update config
try {
    $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    
    # Ensure plugins object exists
    if (-not $config.plugins) {
        $config | Add-Member -NotePropertyName "plugins" -NotePropertyValue (@{})
    }
    
    # Ensure plugins.entries exists
    if (-not $config.plugins.entries) {
        $config.plugins | Add-Member -NotePropertyName "entries" -NotePropertyValue (@{})
    }
    
    # Ensure plugins.slots exists
    if (-not $config.plugins.slots) {
        $config.plugins | Add-Member -NotePropertyName "slots" -NotePropertyValue (@{})
    }
    
    # Add plugin entry
    $config.plugins.entries | Add-Member -NotePropertyName "lobstermind-memory" -NotePropertyValue (@{
        "enabled" = $true
        "config" = @{"enabled" = $true}
    }) -Force
    
    # Set memory slot
    $config.plugins.slots.memory = "lobstermind-memory"
    
    # Save config
    $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
    
    Write-Host "✅ Configuration updated" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Could not update configuration automatically." -ForegroundColor Yellow
    Write-Host "   Please manually add to openclaw.json:" -ForegroundColor Yellow
    Write-Host @"

  "plugins": {
    "slots": {
      "memory": "lobstermind-memory"
    },
    "entries": {
      "lobstermind-memory": {
        "enabled": true,
        "config": {
          "enabled": true
        }
      }
    }
  }
"@
}

Write-Host ""
Write-Host "✅ Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📖 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Restart OpenClaw: openclaw doctor"
Write-Host "   2. Test the plugin: openclaw memories --help"
Write-Host "   3. Add a memory: openclaw memories --add `"Your memory here`""
Write-Host ""
Write-Host "📚 Documentation: https://github.com/pnll1991/lobstermind-memory" -ForegroundColor Cyan
Write-Host ""
