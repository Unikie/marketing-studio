#!/bin/sh
echo "{\"apiUrl\":\"${BACKEND_URL}\"}" > /usr/share/nginx/html/config.json
exec nginx -g 'daemon off;'
