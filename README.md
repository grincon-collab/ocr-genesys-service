📖 Manual de Arquitectura: Sistema OCR Serverless para Extracción de Cédulas 1. Introducción y Objetivo del Sistema Este documento detalla la arquitectura, configuración y código fuente de una solución de Inteligencia Artificial diseñada para integrarse de forma nativa con Genesys Cloud. El objetivo principal de este ecosistema es automatizar el proceso de validación de identidad. Permite que un usuario envíe una fotografía de su documento de identidad (cédula) a través de un bot de WhatsApp y, mediante visión artificial, el sistema extrae automáticamente el número del documento para devolverlo como un dato estructurado al flujo conversacional, todo en cuestión de segundos.2. Visión General de la Arquitectura (El Ecosistema) Para garantizar un procesamiento rápido, seguro y sin caídas por falta de memoria, el sistema fue diseñado bajo un modelo de microservicios (serverless). Se compone de tres pilares fundamentales:El Orquestador y Puente (Genesys Cloud): Un script intermedio (OCRCedula.js) se encarga de escuchar la interacción en curso, buscar el archivo adjunto (foto) enviado por el cliente, descargarlo mediante la API de Genesys y prepararlo (conversión a Base64) para su análisis externo.El Microservicio Intermediario (Render + Node.js): Una API REST pública y ligera (ocr-api-genesys), alojada en la plataforma Render. Recibe la imagen de Genesys, gestiona la autenticación segura y funciona como traductor entre el bot y el motor de IA.El Motor de Inteligencia Artificial (Google Cloud Vision): El núcleo del reconocimiento óptico de caracteres (OCR). Gracias a la infraestructura de Google, el sistema es capaz de leer texto en fotografías rotadas, borrosas o con iluminación deficiente, garantizando una alta tasa de éxito.2.1. Ventajas del Diseño Técnico Bajo Consumo de Recursos: Al delegar el análisis pesado de imágenes a Google Vision, el servidor de Node.js se mantiene ligero, eliminando la necesidad de librerías locales de manipulación gráfica que saturan la memoria RAM.Alta Resiliencia: El script puente en Genesys cuenta con mecanismos de reintento automático (httpFetchWithRetry), lo que asegura que micro-cortes de red no afecten la experiencia del usuario en WhatsApp.Seguridad: Las credenciales de acceso a la Inteligencia Artificial se gestionan estrictamente a través de variables de entorno (.env) encriptadas en la nube, manteniendo el código fuente en GitHub completamente limpio y seguro.3. El Flujo de Datos (Orden de Ejecución) El objetivo de este entorno es recibir la fotografía, extraer el texto y devolver los datos estructurados:El Usuario (WhatsApp): El cliente toma una foto de su cédula y la envía al bot a través del canal de WhatsApp.El Orquestador (Genesys Cloud): El flujo de Architect en Genesys recibe la imagen, la convierte a un formato de texto largo llamado Base64 y hace una petición HTTP (POST) a través de un Data Action.El Intermediario (API en Render): Tu servidor en Node.js recibe el Base64 de Genesys. Toma el Base64, lo convierte en un "Buffer" (un archivo en memoria) y se lo entrega a Google.El Cerebro (Google Cloud Vision): Google recibe la imagen en sus servidores, le aplica su modelo de reconocimiento óptico de caracteres (OCR) y devuelve al servidor de Render todo el texto que logró leer.El Filtro (Regex en Node.js): Tu servidor recibe el texto crudo de Google y usa una expresión regular (match) para buscar el patrón específico de la cédula (ej. de 7 a 11 dígitos).La Respuesta: El servidor de Node.js empaqueta el número encontrado en un formato JSON ({ "cedula": "1234567" }) y se lo devuelve a Genesys.El Resultado Final: Genesys lee el JSON, guarda la cédula en una variable y el bot le responde al usuario en WhatsApp con el número detectado.4. Aplicaciones y Herramientas Utilizadas Este es el stack tecnológico ordenado desde la cara del cliente hasta el motor de procesamiento:WhatsApp (Frontend): El canal de comunicación donde el usuario interactúa y envía la fotografía.Genesys Cloud (Plataforma CX): Maneja la lógica del bot (Architect) y las integraciones (Data Actions). Inicia el proceso de validación.GitHub (Control de Versiones): La bóveda donde vive tu código fuente (server.js y package.json). Cuando haces un cambio, avisa automáticamente al servidor para actualizar.Render.com (Hosting / PaaS): Plataforma en la nube que mantiene el código vivo y escuchando en el puerto 10000. Aloja la variable GOOGLE_CREDENTIALS.Node.js + Express (Servidor Middleware): Usa express para crear la ruta /api/extract. Permite un límite ampliado de 10mb para soportar fotos pesadas.Google Cloud Platform (GCP): Provee la API de Cloud Vision para leer las imágenes en menos de 2 segundos mediante una Cuenta de Servicio.5. Función de Extracción de Archivos (OCRCedula.js) Descripción: Función intermediaria (típicamente desplegada como AWS Lambda o Genesys Cloud Function) encargada de interceptar una conversación en curso, descargar el último archivo adjunto enviado por el cliente, convertirlo a Base64 y enviarlo al servicio OCR externo alojado en Render.5.1. Contrato de Entrada (Input Contract) El script espera recibir un objeto JSON que contiene los identificadores básicos. Si faltan, la función abortará con un error 400.JSON{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "title": "Petición de Extracción de Imagen Genesys",
  "description": "Datos necesarios para buscar la imagen en la conversación",
  "type": "object",
  "properties": {
    "conversationId": {
      "type": "string",
      "description": "El ID único de la interacción actual en Genesys Cloud."
    },
    "ani": {
      "type": "string",
      "description": "El identificador o número de teléfono del cliente."
    }
  },
  "required": [
    "conversationId",
    "ani"
  ]
}
[Referencia de fuente del esquema: 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74]5.2. Contrato de Salida (Output Contract) La función responde con un objeto estructurado que indica si el proceso fue exitoso y el número de la cédula.JSON{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "title": "Respuesta del Middleware OCR",
  "description": "Resultado de la extracción de la cédula y estado del proceso",
  "type": "object",
  "properties": {
    "status": {
      "type": "integer",
      "description": "Código HTTP de estado (200 = Éxito, 400 = Error de parámetros, 404 = Sin imagen, 500 = Error interno)."
    },
    "success": {
      "type": "boolean",
      "description": "Verdadero si se detectó una cédula válida, Falso si falló o no se encontró."
    },
    "cedula": {
      "type": "string",
      "description": "El número de cédula detectado, o la cadena 'No detectada' / 'Error'."
    },
    "summary": {
      "type": "string",
      "description": "Mensaje resumen de la operación (ej. '✅ Cédula detectada' o '⚠️ No se detectó cédula')."
    },
    "message": {
      "type": "string",
      "description": "Mensaje técnico en caso de error interno (solo presente si status = 500)."
    },
    "error": {
      "type": "string",
      "description": "Detalle del stack trace del error (solo presente si status = 500)."
    }
  }
}
[Referencia de fuente del esquema: 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]5.3. Código Fuente del Puente JavaScript// Descomenta la siguiente línea si usas Node 16 o inferior en tu servidor/Lambda:
// const fetch = require('node-fetch');
exports.handler = async (args) => {
  const clientId      = 'a262a6f6-a6cb-4660-8346-343badd3179a';
  const clientSecret  = 'YEDL1H8eVeynwwiKMF09D9-RfXkELUjkzBbEtqPxQNo';
  const loginBase     = 'https://login.mypurecloud.com';
  const apiBase       = 'https://api.mypurecloud.com';
  const ocrApiUrl     = 'https://ocr-genesys-service.onrender.com/api/extract';
  
  const { conversationId, ani } = args || {};
  if (!conversationId || !ani) {
    return { status: 400, success: false, message: 'Faltan parámetros: conversationId y ani' };
  }
  
  try {
    const token = await getOAuthToken({ loginBase, clientId, clientSecret });
    const archivo = await getSingleDocFromCustomer({ apiBase, conversationId, token });

    if (!archivo) {
      return { status: 404, success: false, cedula: "No detectada", summary: "Sin adjuntos" };
    }
    
    const rawBase64 = await urlToRawBase64({ url: archivo.url, token });
    const ocrRaw = await httpFetchWithRetry(ocrApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ocrBase64: rawBase64 }),
      timeoutMs: 30000
    });
    
    const result = await ocrRaw.json();
    const success = (result.cedula && result.cedula !== "No detectada");

    return {
      status: 200,
      success: success,
      cedula: result.cedula || "No detectada",
      summary: success ? `✅ Cédula "${result.cedula}" detectada.` : `⚠️ No se detectó cédula.`
    };
  } catch (e) {
    return {
      status: 500,
      success: false,
      cedula: "Error",
      message: 'Fallo interno en el puente',
      error: String(e.message)
    };
  }
};

async function getOAuthToken({ loginBase, clientId, clientSecret }) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await httpFetchWithRetry(`${loginBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    timeoutMs: 12000
  });
  const json = await r.json();
  return json.access_token;
}

async function getSingleDocFromCustomer({ apiBase, conversationId, token }) {
  const url = `${apiBase}/api/v2/conversations/${conversationId}`;
  const r = await httpFetchWithRetry(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    timeoutMs: 15000
  });

  const data = await r.json();
  const docs = [];

  const collect = (node) => {
    if (!node) return;
    if (Array.isArray(node.media)) {
      node.media.forEach(m => {
        if (m?.url) docs.push({ url: m.url, ts: node.messageTime });
      });
    }
    if (Array.isArray(node.messages)) {
      node.messages.forEach(collect);
    }
  };
  
  if (Array.isArray(data?.participants)) {
    data.participants
      .filter(p => (p.purpose || '').toLowerCase() === 'customer')
      .forEach(p => {
        if (Array.isArray(p.messages)) p.messages.forEach(collect);
      });
  }
  
  if (!docs.length) return null;
  return docs.sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0))[0];
}

async function urlToRawBase64({ url, token }) {
  const r = await httpFetchWithRetry(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    timeoutMs: 30000
  });

  const ab = await r.arrayBuffer();
  return Buffer.from(ab).toString('base64').replace(/\s+/g, '');
}

async function httpFetchWithRetry(url, options = {}) {
  const { timeoutMs = 15000, retry = 2, ...rest } = options;
  let attempt = 0, lastErr;

  while (attempt <= retry) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort('timeout'), timeoutMs);
    try {
      const r = await fetch(url, { signal: controller.signal, ...rest });
      clearTimeout(id);
      return r;
    } catch (e) {
      clearTimeout(id);
      lastErr = e;
      attempt++;
      await new Promise(res => setTimeout(res, 500));
    }
  }
  throw lastErr;
}
[Referencia de fuente del código: 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225]6. Microservicio OCR en GitHub (ocr-api-genesys) 6.1. .gitignore (Políticas de Seguridad y Limpieza) Descripción: Bloquea archivos sensibles o innecesarios para que no se suban al repositorio público de GitHub, protegiendo las credenciales.node_modules: Evita subir los archivos pesados de las librerías..env: Regla de oro de seguridad, bloquea la subida de variables de entorno (JSON de Google Cloud).documento_final.png / opt_*.png: Evita que se suban fotos de pruebas.6.2. package.json (Manifiesto del Proyecto) Descripción: Indica al servidor cómo se llama la aplicación, el comando de arranque y las herramientas a descargar."start": "node server.js": Comando de arranque automatizado.dependencies: Optimizado requiriendo solo express y @google-cloud/vision para mantener un consumo bajo de RAM.6.3. server.js (El Motor de OCR y API) Descripción: Recibe la petición HTTP de Genesys, se autentica con Google Cloud, extrae el texto y filtra el número de cédula mediante expresiones regulares.Puntos Clave:Límite de Payload (limit: '10mb'): Evita el error "Payload Too Large".Diagnóstico de Arranque: Valida que la variable GOOGLE_CREDENTIALS exista antes de procesar.Procesamiento Serverless: Delega el peso del OCR a Google (client.textDetection()).Extracción Inteligente (Regex): Convierte el texto eliminando letras (/\D/g) y busca secuencias numéricas (/\d{7,11}/).7. Infraestructura: Servidor en Render Descripción: Plataforma de alojamiento donde se ejecuta el microservicio Node.js (ocr-api-genesys). Actúa como intermediario público que recibe las imágenes.URL Base (Pública): https://ocr-genesys-service.onrender.com Puerto Interno: 10000 Comandos: Build (npm install), Start (npm start o node server.js).Variables de Entorno: Importadas desde un .env. La Key principal es GOOGLE_CREDENTIALS y el Value es el JSON validado (en una sola línea).Troubleshooting: Para resolver errores de lectura, forzar el despliegue con la opción Clear Build Cache & Deploy.8. Conclusión del Flujo El Origen (Genesys Architect): Invoca tu función OCRCedula.js pasándole el conversationId. ¡Architect no lidia con archivos pesados!.El Puente Inteligente (Tu Función): Hace el trabajo de investigar, descarga la foto, la convierte a Base64 y hace la llamada al Web Service de Render.El Motor (Render + Google Vision): Extrae el texto con IA y filtra la cédula.La Entrega Final: La función empaqueta la respuesta limpia ({ success: true, cedula: "1234567" }) para que Genesys responda en WhatsApp.
