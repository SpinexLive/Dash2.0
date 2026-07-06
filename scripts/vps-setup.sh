#!/usr/bin/env bash
# VPS hardening for the HLL Dashboard (Ubuntu/Debian). Run as root.
set -euo pipefail

DOMAIN="${1:-your-domain.com}"
EMAIL="${2:-admin@your-domain.com}"

echo "==> Updating packages"
apt-get update && apt-get -y upgrade
apt-get install -y ufw fail2ban nginx certbot python3-certbot-nginx unattended-upgrades

echo "==> Firewall (UFW): allow only SSH + HTTP/HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> fail2ban: enable sshd + nginx jails"
cat >/etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
EOF
systemctl enable --now fail2ban

echo "==> SSH hardening (key-only auth)"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> TLS certificate via Let's Encrypt"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
  echo "Certbot step skipped/failed — run manually once DNS points here."

echo "==> Done. Next: docker compose --env-file .env up -d --build"
