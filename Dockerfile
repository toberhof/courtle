# Base image: PHP 8.2 with built-in Apache web server
FROM php:8.2-apache

# 1. System updates and SQLite libraries
# The rm at the end clears the apt cache to keep the image small
RUN apt-get update && apt-get install -y \
    libsqlite3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Enable PHP extensions for PDO and SQLite
RUN docker-php-ext-install pdo pdo_sqlite

# 3. Enable Apache mod_rewrite + mod_remoteip (essential for API routing and proxy trust)
RUN a2enmod rewrite remoteip

# 4. Apache proxy trust config (Cloudflare / Traefik)
COPY courtle.conf /etc/apache2/conf-available/courtle.conf
RUN a2enconf courtle

# 5. Set the default working directory inside the container
WORKDIR /var/www/html

# 6. Copy all local code into the container's web directory
# (files listed in .dockerignore are excluded)
COPY . /var/www/html/

# 7. Create vendor directory and download external assets (no CDN at runtime)
RUN mkdir -p /var/www/html/vendor/lucide /var/www/html/vendor/fonts && \
    curl -sL https://unpkg.com/lucide@latest/dist/umd/lucide.js \
      -o /var/www/html/vendor/lucide/lucide.js && \
    curl -sL "https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2" \
      -o /var/www/html/vendor/fonts/DMSans-latin.woff2 && \
    curl -sL "https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu6-K6h9Q.woff2" \
      -o /var/www/html/vendor/fonts/DMSans-latin-ext.woff2 && \
    curl -sL "https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zUTjg.woff2" \
      -o /var/www/html/vendor/fonts/InstrumentSerif-latin.woff2 && \
    curl -sL "https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zsTjmbI.woff2" \
      -o /var/www/html/vendor/fonts/InstrumentSerif-latin-ext.woff2 && \
    curl -sL "https://fonts.gstatic.com/s/instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjjH7M.woff2" \
      -o /var/www/html/vendor/fonts/InstrumentSerif-italic-latin.woff2 && \
    curl -sL "https://fonts.gstatic.com/s/instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjgn7MsNo.woff2" \
      -o /var/www/html/vendor/fonts/InstrumentSerif-italic-latin-ext.woff2

# 8. Clean up build artifacts from webroot
# Dockerfile and courtle.conf are only needed at build time.
RUN rm -f /var/www/html/Dockerfile /var/www/html/courtle.conf

# 9. Set permissions + entrypoint
# The www-data user needs write access to the directory
# where .db files reside, as SQLite creates temporary journal files.
RUN mkdir -p /var/www/courtle_data && chown -R www-data:www-data /var/www/html /var/www/courtle_data
# 10. Install entrypoint
COPY docker-entrypoint.sh /usr/local/bin/courtle-entrypoint
RUN chmod +x /usr/local/bin/courtle-entrypoint
# 11. Entrypoint: fix permissions then start Apache
ENTRYPOINT ["courtle-entrypoint"]