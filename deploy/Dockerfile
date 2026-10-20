# syntax=docker/dockerfile:1
# Buildx seleciona a arquitetura nativa do estágio; publish gera IL portável.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG PROJECT=Api
WORKDIR /source
COPY . .
# proxy_ca é opcional e só existe durante o restore no ambiente de desenvolvimento gerenciado.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    dotnet restore src/MiniShop.${PROJECT}/MiniShop.${PROJECT}.csproj && \
    dotnet publish src/MiniShop.${PROJECT}/MiniShop.${PROJECT}.csproj -c Release --no-restore -o /out /p:UseAppHost=false && chmod -R a+rX /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
ARG PROJECT=Api
ENV APP_DLL=MiniShop.${PROJECT}.dll ASPNETCORE_HTTP_PORTS=8080
WORKDIR /app
COPY --from=build /out ./
RUN mkdir -p /home/app/.aspnet/DataProtection-Keys && chown -R "$APP_UID:$APP_UID" /home/app/.aspnet
USER $APP_UID
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD ["/bin/sh","-c","dotnet $APP_DLL --healthcheck"]
ENTRYPOINT ["/bin/sh","-c","exec dotnet \"$APP_DLL\" \"$@\"","--"]
