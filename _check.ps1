Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in 10644, 12304 } | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-List
