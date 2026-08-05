FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Must be the public API URL, e.g. https://xxx.up.railway.app (NOT the web URL)
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN if [ -z "$VITE_API_URL" ]; then echo "ERROR: VITE_API_URL build arg is required" && exit 1; fi
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
ENV PORT=3000
EXPOSE 3000
CMD serve -s dist -l ${PORT}
