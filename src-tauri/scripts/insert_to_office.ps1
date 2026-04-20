# Office COM Automation Script
# Inserts a docx file into the active Word or WPS document at cursor position

param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

# Helper function to check if a process is running
function Test-ProcessRunning {
    param([string]$ProcessName)
    return (Get-Process | Where-Object { $_.ProcessName -eq $ProcessName } | Measure-Object).Count -gt 0
}

# Helper function to get process name from window handle
function Get-ForegroundProcessName {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll")]
    public static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);

    public const uint PROCESS_QUERY_INFORMATION = 0x0400;
    public const uint PROCESS_VM_READ = 0x0010;
}
"@

    try {
        $hwnd = [WinAPI]::GetForegroundWindow()
        $pid = 0
        [void][WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid)

        $hProcess = [WinAPI]::OpenProcess([WinAPI]::PROCESS_QUERY_INFORMATION -bor [WinAPI]::PROCESS_VM_READ, $false, $pid)
        if ($hProcess -eq [IntPtr]::Zero) {
            return $null
        }

        $sb = New-Object System.Text.StringBuilder(1024)
        $size = 1024
        [void][WinAPI]::QueryFullProcessImageName($hProcess, 0, $sb, [ref]$size)
        [void][WinAPI]::CloseHandle($hProcess)

        return [System.IO.Path]::GetFileName($sb.ToString()).ToUpper()
    }
    catch {
        return $null
    }
}

try {
    # Check if file exists
    if (-not (Test-Path $FilePath)) {
        Write-Output "ERROR: File not found: $FilePath"
        exit 1
    }

    # Get the absolute path
    $FullPath = (Resolve-Path $FilePath).Path

    # Check foreground window to determine target application
    $foregroundProcess = Get-ForegroundProcessName
    $targetApp = $null

    if ($foregroundProcess -match "WINWORD") {
        $targetApp = "Word.Application"
    }
    elseif ($foregroundProcess -match "WPS|KWPS") {
        # Try WPS ProgIDs
        $targetApp = $null
        $wpsProgIds = @("Kwps.Application", "Wps.Application", "KWps.Application")
    }
    else {
        # Default: try Word first, then WPS
        $targetApp = "Word.Application"
    }

    # Try to get active Word instance
    $officeApp = $null
    $errorMsg = ""

    if ($targetApp -eq "Word.Application") {
        try {
            $officeApp = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application")
        }
        catch {
            $errorMsg = "No active Word instance found"
        }
    }

    # If Word not found or not target, try WPS
    if ($officeApp -eq $null -and $targetApp -eq $null) {
        foreach ($progId in $wpsProgIds) {
            try {
                $officeApp = [Runtime.InteropServices.Marshal]::GetActiveObject($progId)
                if ($officeApp -ne $null) {
                    break
                }
            }
            catch {
                continue
            }
        }
    }

    if ($officeApp -eq $null) {
        Write-Output "ERROR: No active Office application found. $errorMsg"
        exit 1
    }

    # Get the Selection object
    $selection = $officeApp.Selection
    if ($selection -eq $null) {
        Write-Output "ERROR: Cannot get Selection object"
        exit 1
    }

    # Try to insert file directly at cursor position
    try {
        $selection.InsertFile($FullPath)
        Write-Output "SUCCESS"
        exit 0
    }
    catch {
        # Fallback: Open document → Select All → Copy → Close → Paste
        Write-Output "InsertFile failed, using fallback method..."

        try {
            # Open the temp document
            $tempDoc = $officeApp.Documents.Open($FullPath)

            if ($tempDoc -eq $null) {
                Write-Output "ERROR: Failed to open temp document"
                exit 1
            }

            # Select all content and copy
            $tempDoc.Content.Select()
            $officeApp.Selection.Copy()

            # Close temp document without saving
            $tempDoc.Close([ref]$false)

            # Paste at original cursor position
            $selection.Paste()

            Write-Output "SUCCESS"
            exit 0
        }
        catch {
            Write-Output "ERROR: Fallback method failed: $_"
            exit 1
        }
    }
}
catch {
    Write-Output "ERROR: $_"
    exit 1
}
