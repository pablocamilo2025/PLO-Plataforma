# Operación del catálogo de Price Radar

## Preparar el archivo

En Administración → Radar de precios, usar **Descargar plantilla CSV**. El archivo contiene los encabezados admitidos por el importador y ninguna fila ficticia. Completar una fila por producto, hasta 500 filas (objetivo inicial: 200).

| Columna | Contenido |
|---|---|
| sku | Código único PLO, como texto. Letras, números, punto, guion y guion bajo. |
| nombre | Nombre completo del producto. |
| laboratorio | Laboratorio identificado, no el distribuidor. |
| concentracion | Dosis y unidad; incluir ambas dosis si hay combinación. |
| presentacion | Forma, cantidad y liberación: por ejemplo, 30 comprimidos de liberación prolongada. |
| ean | Opcional; conservar como texto, incluidos ceros iniciales. Se valida dígito verificador. |
| marca | Opcional; completar cuando exista. |
| principio_activo | Opcional; completar para mejorar búsquedas. |

Los primeros cinco campos son obligatorios. No usar fórmulas, celdas combinadas ni varias hojas con datos en Excel. El costo, IVA y precio de venta pertenecen al catálogo comercial; este archivo es de identificación para Radar y no modifica precios de compra del Portal.

## Desde la importación hasta las consultas

1. Importar y revisar la vista previa. Elegir Prueba para ensayos u Oficial para la lista real. La importación crea un borrador local.
2. Guardar en servidor. Conservar el número de revisión compartida.
3. Buscar fichas por producto. Actualmente la búsqueda integrada consulta Simi y ECO; puede devolver errores o candidatos incompletos. Cruz Verde requiere completar su revisión. La extracción automática de una URL conocida y la búsqueda de la URL son procesos distintos.
4. Revisar identidad y evidencia. Una coincidencia de dosis y cantidad no acredita mismo laboratorio, marca o condiciones comerciales. Dejar sin referencia cuando no exista equivalente.
5. Guardar decisiones. Abrir Revisar publicación: muestra cobertura y asociaciones a reemplazar. Completar condiciones de cada precio y confirmar la publicación. Esta acción reemplaza todas las asociaciones del workspace y reinicia sus precios; no activa la cola.
6. Consultar Actualizar estado. Revisar asociaciones activas de todos los catálogos. Preparar activación rechaza una cola vacía o con prueba y oficial mezclados.
7. Confirmar en Render el modo del worker, su salud y capacidad antes de activar. El worker instalado está en `test`; un catálogo oficial necesita cambiarlo a `official` y verificar despliegue. El panel aún no comprueba ese modo automáticamente.
8. Activar consultas, comprobar la primera ronda y errores. Se programa cada asociación a 48 horas desde su éxito. El Portal lee resultados guardados y no dispara una extracción por visitante.

## Estado de esta entrega

Controles disponibles en el administrador local: plantilla CSV, importación, guía, revisión de publicación, pausa, preparación de activación, resumen de pendientes/errores/antigüedad y tabla de asociaciones activas. Usa la API administrativa existente y sus controles de permisos. No se publicaron asociaciones reales ni se habilitó la cola durante esta entrega.

Validación: importador con 200 filas sintéticas; preparación de 600 asociaciones; rechazos de borradores no guardados, evidencia faltante, duplicados y ausencia de propuestas. Prueba de navegador contra Supabase: estado pausado y publicación bloqueada sin asociaciones verificadas. El caso de publicación real no se ejecutó porque falta el catálogo aprobado.

Pendiente antes del uso comercial: lista oficial y asociaciones verificadas, búsqueda por lotes y flujo completo para incorporar fichas CV, comprobación automática del worker, alertas proactivas, pruebas sostenidas/de carga y despliegue de estos cambios del frontend al Portal público. El resumen de errores del panel no es una alerta enviada automáticamente.
