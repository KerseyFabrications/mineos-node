#!/bin/bash
set -eo pipefail

# Web UI password. An explicit USER_PASSWORD is always used. Without one, a
# random password is generated on the first start, kept in /root/password
# (readable by root only) and reused when the same container restarts. It used
# to fall back to the literal default "random_see_log" after a restart.
if [ -z "$USER_PASSWORD" ] || [ "$USER_PASSWORD" = "random_see_log" ]; then
  if [ -s /root/password ]; then
    # older images wrote "Password set to: <password>"
    USER_PASSWORD=$(sed -e 's/^Password set to: *//' -e 's/[[:space:]]*$//' /root/password | head -n 1)
    chmod 600 /root/password
  fi
  if [ -n "$USER_PASSWORD" ] && [ "$USER_PASSWORD" != "random_see_log" ]; then
    echo >&2 "USER_PASSWORD not specified; using the generated password stored in /root/password"
  else
    USER_PASSWORD=$(node -e 'process.stdout.write(require("crypto").randomBytes(15).toString("base64url"))')
    (umask 077 && printf '%s\n' "$USER_PASSWORD" > /root/password)
    echo >&2 '*******************************************************'
    echo >&2 "USER_PASSWORD not specified; generated web UI password: $USER_PASSWORD"
    echo >&2 'It is kept in /root/password. Set USER_PASSWORD to choose your own.'
    echo >&2 '*******************************************************'
  fi
fi

if [ "$USER_NAME" ]; then
  # username specifically provided, will overwrite 'mc'
  if [[ "$USER_NAME" =~ [^a-zA-Z0-9] ]]; then
    echo >&2 'USER_NAME must contain only alphanumerics [a-zA-Z0-9]'
    exit 1
  fi
else
  echo >&2 'USER_NAME not provided; defaulting to "mc"'
  USER_NAME=mc
fi

if [ "$GROUP_NAME" ]; then
  # group name specifically provided, will overwrite 'mc'
  if [[ "$GROUP_NAME" =~ [^a-zA-Z0-9] ]]; then
    echo >&2 'GROUP_NAME must contain only alphanumerics [a-zA-Z0-9]'
    exit 1
  fi
else
  echo >&2 'GROUP_NAME not provided; defaulting to "mc"'
  GROUP_NAME=mc
fi

if [ "$USER_UID" ]; then
  # uid specifically provided, will overwrite 1000 default
  if [[ "$USER_UID" =~ [^0-9] ]]; then
    echo >&2 'USER_UID must contain only numerics [0-9]'
    exit 1
  fi
else
  USER_UID=1000
fi

if [ "$GROUP_GID" ]; then
  # gid specifically provided, will overwrite 1000 default
  if [[ "$GROUP_GID" =~ [^0-9] ]]; then
    echo >&2 'GROUP_GID must contain only numerics [0-9]'
    exit 1
  fi
else
  GROUP_GID=1000
fi

if getent group $GROUP_NAME >/dev/null 2>&1; then
  echo "a group named $GROUP_NAME already exists."
else
  groupadd -og $GROUP_GID $GROUP_NAME
  echo >&2 "Created group: $GROUP_NAME (gid: $GROUP_GID)"
fi

if id -u $USER_NAME >/dev/null 2>&1; then
  echo "a user named $USER_NAME already exists."
else
  useradd -Mos /bin/false -u $USER_UID -g $GROUP_GID $USER_NAME
  echo >&2 "Created user: $USER_NAME (uid: $USER_UID, gid: $GROUP_GID)"
fi

echo >&2 "Setting user password for '$USER_NAME'"
echo "$USER_NAME:$USER_PASSWORD" | chpasswd --crypt-method SHA512

if [ ! -z "$USE_HTTPS" ]; then
  # update mineos.conf from environment
  sed -i 's/use_https = .*/use_https = '${USE_HTTPS}'/g' /etc/mineos.conf
  echo >&2 "Setting use_https to: " $USE_HTTPS
  if [[ -z $SERVER_PORT ]] && [ "$USE_HTTPS" = "true"  ]; then
    Port=8443
  elif [[ -z $SERVER_PORT ]] && [ "$USE_HTTPS" = "false"  ]; then
    Port=8080
  else
    Port=$SERVER_PORT
  fi
  sed -i 's/socket_port = .*/socket_port = '${Port}'/g' /etc/mineos.conf
  echo >&2 "Setting server port to: "$Port
fi

if [[ ! -f /etc/ssl/certs/mineos.crt ]] && [[ ! -z $( grep 'use_https = true' /etc/mineos.conf) ]]; then
  # generate the cert if it is missing and enabled in the config
  echo >&2 "Generating Self-Signed SSL..."
  sh /usr/games/minecraft/generate-sslcert.sh
else
  echo >&2 "Skipping Self-Signed SSL, it either exists or is disabled."
fi

if [ "$USE_HTTPS" ]; then
    if [ "$USE_HTTPS" == "true" ]; then
        echo "Setting https to true"
        sed -i 's/use_https = false/use_https = true/' /etc/mineos.conf

    else
        echo "Setting https to false"
        sed -i 's/use_https = true/use_https = false/' /etc/mineos.conf
    fi
else
    echo "Falling back to https true"
    sed -i 's/use_https = false/use_https = true/' /etc/mineos.conf
fi

# Run supervisor as a child rather than exec'ing it. When the container is
# stopped, save and stop every running Minecraft server first; otherwise the
# servers die with supervisor and lose whatever was not yet written to disk.
# The web UI is stopped first so nothing new can start meanwhile. Give the
# container a stop grace period longer than MINEOS_SHUTDOWN_TIMEOUT.
child=""
stopping=""

stop_games() {
  [ -n "$stopping" ] && return
  stopping=1
  status=0
  echo >&2 "Container stopping: saving and stopping Minecraft servers"
  supervisorctl stop mineos >/dev/null 2>&1 || true
  (cd /usr/games/minecraft && exec node mineos_shutdown.js </dev/null) || {
    status=1
    echo >&2 "Some servers did not stop in time"
  }
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null && wait "$child"
  exit $status
}
trap stop_games TERM INT

"$@" &
child=$!
wait "$child"
