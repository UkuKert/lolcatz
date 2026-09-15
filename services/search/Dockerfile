FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/server .

FROM alpine:3.20
COPY --from=build /app/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
