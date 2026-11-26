#!/usr/bin/env bash
# pc.sh — use Henry's PC "supercomputer" (RTX 3080 Ti, Windows-native Ollama on :11434) for model
# inference, so batch runs don't load the Mac. Adapted from ~/Code/airport-delays/scripts/pc.sh.
#
#   scripts/pc.sh wake       wake via Wake-on-LAN, wait for SSH + Ollama
#   scripts/pc.sh hold       ask Windows to stay awake until `release` (it sleeps after 10 min idle)
#   scripts/pc.sh release    drop the hold
#   scripts/pc.sh sleep      drop the hold and suspend
#   scripts/pc.sh status
#   scripts/pc.sh url        print the Ollama base URL to use (LAN, else an SSH tunnel on 127.0.0.1:11435)
#
# Env: PC_HOST (ssh alias, default supercomputer), PC_OLLAMA_URL (default http://192.168.100.45:11434)
set -uo pipefail
HOST=${PC_HOST:-supercomputer}
MAC=2c:f0:5d:36:44:df
BCAST=192.168.100.255
OLLAMA=${PC_OLLAMA_URL:-http://192.168.100.45:11434}
PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
FLAG='C:\Users\henry\AppData\Local\Temp\sept11-pc-busy'

TUNNEL_PORT=${PC_TUNNEL_PORT:-11435}
ssh_up()    { ssh -o BatchMode=yes -o ConnectTimeout=4 "$HOST" true 2>/dev/null; }
direct_up() { curl -sf -m4 "$OLLAMA/api/version" >/dev/null; }
tunnel_up() { curl -sf -m4 "http://127.0.0.1:$TUNNEL_PORT/api/version" >/dev/null; }
ollama_up() { direct_up || tunnel_up; }

# The Windows firewall may block :11434 from the LAN; SSH (port 22) is always open, and inside WSL
# the Windows-side Ollama answers on the default gateway. Forward a local port through SSH.
tunnel() {
  tunnel_up && return 0
  local gw; gw=$(ssh -o ConnectTimeout=5 "$HOST" "ip route | awk '/default/{print \$3}'") || return 1
  ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L "127.0.0.1:$TUNNEL_PORT:$gw:11434" "$HOST" || return 1
  sleep 1; tunnel_up
}

# Prints the base URL the pipeline should use: direct LAN if reachable, else the SSH tunnel.
# Prefer the SSH tunnel: right after a wake :11434 can answer from the LAN and then stop
# mid-job (Windows firewall), which killed the 2026-11-22 and 11-25 refreshes at pages_py.
url() {
  if tunnel; then echo "http://127.0.0.1:$TUNNEL_PORT"; elif direct_up; then echo "$OLLAMA"; else return 1; fi
}

wake() {
  ollama_up && return 0
  if ssh_up; then tunnel && return 0; fi
  for _ in $(seq 1 60); do
    /usr/bin/python3 - "$MAC" "$BCAST" <<'EOF'
import socket, sys
mac = bytes.fromhex(sys.argv[1].replace(":", ""))
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
for port in (7, 9):
    s.sendto(b"\xff" * 6 + mac * 16, (sys.argv[2], port))
EOF
    sleep 5
    ollama_up && return 0
    ssh_up && tunnel && return 0
  done
  echo "pc.sh: $HOST Ollama not reachable at $OLLAMA after wake (ssh up: $(ssh_up && echo yes || echo no))" >&2
  return 1
}

hold() {
  ssh "$HOST" "echo busy > \"\$(wslpath '$FLAG')\"; nohup $PS -NoProfile -Command \"\\\$t = Add-Type -MemberDefinition '[DllImport(\\\"kernel32.dll\\\")] public static extern uint SetThreadExecutionState(uint f);' -Name P -Namespace W -PassThru; [void]\\\$t::SetThreadExecutionState([uint32]2147483649); while (Test-Path '$FLAG') { Start-Sleep 20 }\" >/dev/null 2>&1 &"
}
release() { ssh -o ConnectTimeout=4 "$HOST" "rm -f \"\$(wslpath '$FLAG')\"" 2>/dev/null; }
suspend() {
  release
  ssh -o ConnectTimeout=4 "$HOST" "$PS -NoProfile -Command \"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', \\\$false, \\\$false)\"" >/dev/null 2>&1 &
  sleep 3
}

case "${1:-}" in
  wake) wake ;;
  url) url ;;
  hold) hold ;;
  release) release ;;
  sleep) suspend ;;
  status)
    if ssh_up; then ssh "$HOST" '/usr/lib/wsl/lib/nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader'
      echo "ollama: $(curl -sf -m4 "$OLLAMA/api/version" || curl -sf -m4 "http://127.0.0.1:$TUNNEL_PORT/api/version" || echo unreachable)"; else echo "$HOST asleep/off"; fi ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
