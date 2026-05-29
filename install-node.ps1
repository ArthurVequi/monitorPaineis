# ============================================================
# Script de Instalação do Node.js - Monitor de Painéis
# Executa como Administrador para instalação silenciosa
# ============================================================

param(
    [string]$NodeVersion = "22.16.0",
    [switch]$ForceReinstall
)

$ErrorActionPreference = "Stop"

# --- Cores para output ---
function Write-Info    { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Ok      { param($msg) Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err     { param($msg) Write-Host "[ERRO] $msg" -ForegroundColor Red }

# --- Banner ---
Write-Host ""
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "  Instalador Node.js - Monitor Paineis  " -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

# --- Verificar se ja esta instalado ---
$nodeInstalled = $false
try {
    $currentVersion = & node --version 2>$null
    if ($currentVersion) {
        $nodeInstalled = $true
        Write-Info "Node.js ja instalado: $currentVersion"
    }
} catch {
    # Node nao encontrado
}

if ($nodeInstalled -and -not $ForceReinstall) {
    Write-Ok "Node.js ja esta instalado. Use -ForceReinstall para reinstalar."
    Write-Host ""
    
    # Verificar npm tambem
    try {
        $npmVersion = & npm --version 2>$null
        Write-Ok "npm versao: $npmVersion"
    } catch {
        Write-Warn "npm nao encontrado no PATH."
    }
    
    Write-Host ""
    Read-Host "Pressione Enter para sair"
    exit 0
}

# --- Verificar se esta executando como Admin ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    Write-Warn "Este script precisa ser executado como Administrador."
    Write-Info "Tentando reabrir como Administrador..."
    
    try {
        Start-Process powershell.exe -Verb RunAs -ArgumentList (
            "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NodeVersion `"$NodeVersion`""
        )
        exit 0
    } catch {
        Write-Err "Falha ao elevar permissoes. Clique com botao direito e selecione 'Executar como Administrador'."
        Read-Host "Pressione Enter para sair"
        exit 1
    }
}

# --- Tentar instalar via winget primeiro ---
Write-Info "Verificando se winget esta disponivel..."

$wingetAvailable = $false
try {
    $wingetCheck = & winget --version 2>$null
    if ($wingetCheck) {
        $wingetAvailable = $true
        Write-Ok "winget encontrado: $wingetCheck"
    }
} catch {
    # winget nao disponivel
}

if ($wingetAvailable) {
    Write-Info "Instalando Node.js via winget..."
    try {
        & winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
        
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Node.js instalado com sucesso via winget!"
        } else {
            Write-Warn "winget retornou codigo $LASTEXITCODE. Tentando metodo alternativo..."
            $wingetAvailable = $false
        }
    } catch {
        Write-Warn "Falha na instalacao via winget. Tentando metodo alternativo..."
        $wingetAvailable = $false
    }
}

# --- Fallback: Download direto do .msi ---
if (-not $wingetAvailable) {
    Write-Info "Instalando Node.js via download direto (v$NodeVersion)..."

    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $msiUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-$arch.msi"
    $msiPath = Join-Path $env:TEMP "node-v$NodeVersion-$arch.msi"

    Write-Info "Baixando de: $msiUrl"
    Write-Info "Salvando em: $msiPath"

    try {
        # Configurar TLS 1.2 (necessario para alguns Windows)
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

        # Download com barra de progresso
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        $ProgressPreference = 'Continue'

        Write-Ok "Download concluido! Tamanho: $([math]::Round((Get-Item $msiPath).Length / 1MB, 1)) MB"
    } catch {
        Write-Err "Falha no download: $_"
        Write-Err "Verifique a conexao com a internet e tente novamente."
        Read-Host "Pressione Enter para sair"
        exit 1
    }

    # Instalar silenciosamente
    Write-Info "Instalando Node.js silenciosamente..."
    try {
        $process = Start-Process msiexec.exe -ArgumentList "/i", "`"$msiPath`"", "/qn", "/norestart" -Wait -PassThru
        
        if ($process.ExitCode -eq 0) {
            Write-Ok "Node.js instalado com sucesso!"
        } elseif ($process.ExitCode -eq 3010) {
            Write-Ok "Node.js instalado com sucesso! (Reinicializacao recomendada)"
        } else {
            Write-Err "Instalacao falhou com codigo: $($process.ExitCode)"
            Read-Host "Pressione Enter para sair"
            exit 1
        }
    } catch {
        Write-Err "Erro durante a instalacao: $_"
        Read-Host "Pressione Enter para sair"
        exit 1
    }

    # Limpar arquivo temporario
    Write-Info "Limpando arquivo temporario..."
    Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
}

# --- Atualizar PATH na sessao atual ---
Write-Info "Atualizando variaveis de ambiente..."
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

# --- Verificar instalacao ---
Write-Host ""
Write-Host "-----------------------------------------" -ForegroundColor Magenta
Write-Info "Verificando instalacao..."

Start-Sleep -Seconds 2

try {
    $nodeVer = & node --version 2>$null
    Write-Ok "Node.js: $nodeVer"
} catch {
    Write-Warn "node nao encontrado no PATH. Pode ser necessario reiniciar o terminal."
}

try {
    $npmVer = & npm --version 2>$null
    Write-Ok "npm:     $npmVer"
} catch {
    Write-Warn "npm nao encontrado no PATH. Pode ser necessario reiniciar o terminal."
}

Write-Host "-----------------------------------------" -ForegroundColor Magenta
Write-Host ""
Write-Ok "Instalacao finalizada!"
Write-Info "Se os comandos node/npm nao forem reconhecidos, feche e reabra o terminal."
Write-Host ""
Read-Host "Pressione Enter para sair"
