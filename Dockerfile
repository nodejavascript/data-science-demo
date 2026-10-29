# Data science demo — a static page, so the image is a web server and nothing else.
#
# There is no build step and no runtime dependency to install: the statistics run in the visitor's
# browser out of `site/stats.js`, and the datasets are JSON files. That is deliberate — a page
# whose arithmetic needs a server is a page whose arithmetic cannot be checked by reading it.
FROM nginx:alpine

# 🔴 ONE Cache-Control, SET HERE AND NOT IN THE PAGE. Part 7d: the app must not add a second one for
# the edge to fill around. A deploy that a browser serves from cache is a deploy nobody can see.
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  add_header Cache-Control "no-store" always;' \
  '  add_header X-Content-Type-Options "nosniff" always;' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

COPY site/ /usr/share/nginx/html/
EXPOSE 80
