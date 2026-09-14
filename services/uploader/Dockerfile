FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /uploader .

FROM alpine:3.20
RUN adduser -D -u 1001 app
USER app
COPY --from=builder /uploader /uploader
EXPOSE 8080
ENTRYPOINT ["/uploader"]
