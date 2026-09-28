# Despliegue Render

Blueprint en `/render.yaml`: un background worker Docker, 512 MB / 0.5 CPU, Virginia, una instancia, despliegues automáticos desactivados. Coste de cómputo publicado al preparar: USD 7/mes más impuestos/extras y eventual plan del workspace. Sin disco, Redis, nueva base de datos ni servicio web.

1. Iniciar sesión en Render y conectar únicamente el repositorio PLO-Plataforma.
2. Crear Blueprint desde la rama `codex/price-radar-render`, archivo render.yaml.
3. Revisar que aparezca un solo worker y el precio esperado antes de crearlo.
4. Configurar SUPABASE_SERVICE_ROLE_KEY y BROWSERBASE_API_KEY como secretos del servicio. Esto otorga a Render acceso a Supabase y Browserbase; requiere autorización del propietario. Nunca subir browserbase.env al repositorio ni pegar secretos en logs.
5. Mantener RADAR_CATALOG_KIND=test y radar_settings.enabled=false durante instalación. Un worker encendido consume alojamiento aunque la cola esté pausada; no debería abrir sesiones Browserbase hasta existir trabajo habilitado.
6. Revisar logs de arranque, consumo de memoria y una prueba aislada de cola desde el servidor. No ejecutar queue-smoke local mientras el worker remoto esté activo: ambos podrían reclamar la fixture.
7. Una vez disponibles los SKU oficiales y fichas revisadas: publicar asociaciones, cambiar el modo del worker a official y activar la cola en un paso coordinado. La API del Portal debe conectarse y probarse antes de anunciar disponibilidad.

La configuración permite 300 segundos de cierre para terminar el trabajo en curso. Las tareas interrumpidas recuperan su lease después de 5 minutos. Cada fuente/SKU se actualiza cada 48 horas; no es un cron del servidor.

Referencias verificadas: https://render.com/docs/blueprint-spec y https://render.com/pricing . El blueprint no crea recursos hasta aplicarlo en Render. No se incluye ninguna clave.
