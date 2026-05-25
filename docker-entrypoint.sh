#!/bin/sh
# Try to chown (works in named volumes and newer VirtioFS on macOS).
# Fall back to chmod so www-data can always write even if chown is denied
# (older Docker Desktop bind-mounts, certain Linux rootless setups).
chown -R www-data:www-data /var/www/courtle_data 2>/dev/null \
  || chmod -R 777 /var/www/courtle_data 2>/dev/null \
  || true
exec docker-php-entrypoint apache2-foreground
