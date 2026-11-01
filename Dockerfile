FROM nginx:1.29-alpine
LABEL org.opencontainers.image.title="Quirk Notes"
LABEL org.opencontainers.image.description="The web version of Quirk Notes, a handwriting notes app"
LABEL org.opencontainers.image.source="https://github.com/warriorbiswas-tech/Quirk-notes"
COPY index.html manifest.webmanifest sw.js /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY icons /usr/share/nginx/html/icons
COPY vendor /usr/share/nginx/html/vendor
