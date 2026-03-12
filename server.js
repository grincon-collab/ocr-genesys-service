const express = require('express');
const vision = require('@google-cloud/vision');
const crypto = require('crypto');
const app = express();

// ──────────────────────────────────────────────
// CONFIGURACIÓN
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.OCR_API_KEY || 'ITX-OCR-SECRET-2026';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1 minuto
const RATE_LIMIT_MAX = 30;                // 30 peticiones por minuto por IP
const MAX_BASE64_SIZE_MB = 10;
const MIN_IMAGE_SIZE_KB = 40;
const MIN_CONFIDENCE = 0.80;

// ──────────────────────────────────────────────
// GOOGLE VISION - INICIALIZACIÓN SEGURA
// ──────────────────────────────────────────────
let client = null;
let visionReady = false;

try {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    if (!rawCreds) {
        throw new Error('Variable GOOGLE_CREDENTIALS no está definida');
    }
    const credentials = JSON.parse(rawCreds);
    client = new vision.ImageAnnotatorClient({ credentials });
    visionReady = true;
    console.log(`✅ Google Cloud Vision conectado: ${credentials.project_id}`);
} catch (error) {
    console.error(`❌ Google Vision NO inicializado: ${error.message}`);
    console.error('El servidor arrancará pero rechazará peticiones OCR.');
}

// ──────────────────────────────────────────────
// RATE LIMITING (sin dependencia externa)
// ──────────────────────────────────────────────
const rateLimitMap = new Map();

setInterval(() => {
    rateLimitMap.clear();
}, RATE_LIMIT_WINDOW_MS);

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const count = rateLimitMap.get(ip) || 0;

    if (count >= RATE_LIMIT_MAX) {
        console.log(`[RATE LIMIT] IP bloqueada: ${ip} (${count} peticiones en ventana)`);
        return res.status(429).json({
            error: 'Demasiadas solicitudes. Intente en 1 minuto.'
        });
    }

    rateLimitMap.set(ip, count + 1);
    next();
}

// ──────────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────────
app.use(express.json({ limit: `${MAX_BASE64_SIZE_MB}mb` }));

// Cabeceras de seguridad (sin helmet, manual)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// ──────────────────────────────────────────────
// AUTENTICACIÓN
// ──────────────────────────────────────────────
function authenticate(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({ error: 'Se requiere header x-api-key' });
    }

    // Comparación timing-safe
    try {
        const keyBuffer = Buffer.from(apiKey);
        const secretBuffer = Buffer.from(API_KEY);
        if (keyBuffer.length !== secretBuffer.length || !crypto.timingSafeEqual(keyBuffer, secretBuffer)) {
            return res.status(401).json({ error: 'API key inválida' });
        }
    } catch {
        return res.status(401).json({ error: 'API key inválida' });
    }

    next();
}

// ──────────────────────────────────────────────
// VALIDACIÓN DE IMAGEN
// ──────────────────────────────────────────────
function validateImageBase64(ocrBase64) {
    if (!ocrBase64 || typeof ocrBase64 !== 'string') {
        return { valid: false, error: 'Falta el campo ocrBase64' };
    }

    // Limpiar prefijo data URI si viene
    const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, '');

    // Validar que sea base64 real
    if (!/^[A-Za-z0-9+/]+=*$/.test(base64Data.substring(0, 100))) {
        return { valid: false, error: 'El contenido no es base64 válido' };
    }

    // Decodificar
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Validar tamaño mínimo
    const sizeKB = imageBuffer.length / 1024;
    if (sizeKB < MIN_IMAGE_SIZE_KB) {
        return {
            valid: false,
            error: 'La imagen es muy pequeña o es una miniatura. Por favor, toma la foto más de cerca.',
            isQuality: true
        };
    }

    // Validar magic bytes (que sea imagen real)
    const header = imageBuffer.subarray(0, 4);
    const isJPEG = header[0] === 0xFF && header[1] === 0xD8;
    const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
    const isWebP = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;

    if (!isJPEG && !isPNG && !isWebP) {
        return { valid: false, error: 'El archivo no es una imagen válida (se requiere JPEG, PNG o WebP)' };
    }

    return { valid: true, buffer: imageBuffer, sizeKB };
}

// ============================================================
// MÓDULO DE VALIDACIÓN DE DOCUMENTO (SIN CAMBIOS)
// ============================================================

const PALABRAS_CLAVE_DOCUMENTO = [
    'REPUBLICA', 'COLOMBIA', 'CEDULA', 'CIUDADANIA',
    'APELLIDO', 'NOMBRE', 'FECHA', 'NACIMIENTO',
    'LUGAR', 'REGISTRADURIA', 'IDENTIFICACION', 'NUIP',
];

const PATRONES_NO_DOCUMENTO = [
    'FACTURA', 'INVOICE', 'RECIBO', 'TOTAL', 'SUBTOTAL',
    'PRECIO', 'PAGO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA',
    'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'TWITTER', 'TIKTOK',
    'MENU', 'RESTAURANTE', 'DESCUENTO', 'IVA', 'COMPRA',
    'CONTRASEÑA', 'PASSWORD', 'LOGIN', 'USUARIO',
    'WIFI', 'SSID', 'HTTP', 'WWW', '.COM', '.CO',
];

function validarDocumentoIdentidad(textoCompleto, lineas) {
    if (!textoCompleto || textoCompleto.length < 30) {
        return {
            esValido: false,
            razon: "No se detectó texto suficiente en la imagen. Asegúrate de enviar una foto clara de tu documento de identidad."
        };
    }

    if (lineas.length < 4) {
        return {
            esValido: false,
            razon: "La imagen no tiene la estructura de un documento de identidad. Debe contener varias líneas de información."
        };
    }

    const textoUpper = textoCompleto.toUpperCase();

    let contadorSospechoso = 0;
    for (const patron of PATRONES_NO_DOCUMENTO) {
        if (textoUpper.includes(patron)) {
            contadorSospechoso++;
        }
    }
    if (contadorSospechoso >= 2) {
        return {
            esValido: false,
            razon: "La imagen parece ser otro tipo de documento (factura, recibo, captura de pantalla, etc.). Por favor, envía únicamente tu cédula de ciudadanía."
        };
    }

    let coincidenciasDocumento = 0;
    for (const palabra of PALABRAS_CLAVE_DOCUMENTO) {
        if (textoUpper.includes(palabra)) {
            coincidenciasDocumento++;
        }
    }

    if (coincidenciasDocumento < 3) {
        return {
            esValido: false,
            razon: "La imagen no parece ser un documento de identidad colombiano válido. Asegúrate de enviar una foto completa y legible de tu cédula de ciudadanía."
        };
    }

    const soloDigitos = textoCompleto.replace(/\D/g, '');
    const tieneCedula = /\d{7,11}/.test(soloDigitos);
    if (!tieneCedula) {
        return {
            esValido: false,
            razon: "No se detectó un número de cédula válido en el documento. Asegúrate de que el número de identificación sea visible y legible."
        };
    }

    return { esValido: true, razon: null };
}

// ============================================================
// ENDPOINT PRINCIPAL
// ============================================================

app.post('/api/extract', rateLimit, authenticate, async (req, res) => {
    // Verificar que Google Vision está listo
    if (!visionReady || !client) {
        return res.status(503).json({
            error: 'Servicio OCR no disponible temporalmente. Intente más tarde.'
        });
    }

    try {
        const { ocrBase64 } = req.body;

        // Validar imagen
        const imageCheck = validateImageBase64(ocrBase64);
        if (!imageCheck.valid) {
            if (imageCheck.isQuality) {
                return res.json({ calidadAprobada: false, mensajeRechazo: imageCheck.error });
            }
            return res.status(400).json({ error: imageCheck.error });
        }

        // Ejecutar Google Cloud Vision
        const [result] = await client.textDetection(imageCheck.buffer);

        // Filtro de Claridad
        let confidence = 0;
        if (result.fullTextAnnotation && result.fullTextAnnotation.pages.length > 0) {
            confidence = result.fullTextAnnotation.pages[0].confidence || 0;
        }

        if (confidence > 0 && confidence < MIN_CONFIDENCE) {
            return res.json({
                calidadAprobada: false,
                mensajeRechazo: "La foto está borrosa o tiene reflejos de luz. Por favor, tómala de nuevo."
            });
        }

        // Separar texto línea por línea
        const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
        const lineas = text.split('\n').map(l => l.trim().toUpperCase()).filter(l => l !== '');

        // Validación de documento
        const validacion = validarDocumentoIdentidad(text, lineas);
        if (!validacion.esValido) {
            console.log(`[OCR] Documento rechazado: ${validacion.razon.substring(0, 60)}...`);
            return res.json({
                calidadAprobada: false,
                mensajeRechazo: validacion.razon
            });
        }

        // Extracción de datos
        const soloNumeros = text.replace(/\D/g, '');
        const match = soloNumeros.match(/\d{7,11}/);
        const cedulaExtraida = match ? match[0] : "No detectada";

        let apellidosExtraidos = "No detectados";
        const idxApellidos = lineas.findIndex(l => l.includes('APELLIDO'));
        if (idxApellidos > 0) {
            apellidosExtraidos = lineas[idxApellidos - 1];
        }

        let nombresExtraidos = "No detectados";
        const idxNombres = lineas.findIndex(l => l.includes('NOMBRE'));
        if (idxNombres > 0) {
            nombresExtraidos = lineas[idxNombres - 1];
        }

        // Respuesta (MISMA ESTRUCTURA EXACTA)
        const respuestaFinal = {
            calidadAprobada: true,
            cedula: cedulaExtraida,
            nombres: nombresExtraidos,
            apellidos: apellidosExtraidos
        };

        // Log seguro (sin PII)
        console.log(`[OCR] ✅ Documento procesado. Cédula detectada: ${cedulaExtraida ? 'Sí' : 'No'}`);

        res.json(respuestaFinal);

    } catch (error) {
        console.error(`[OCR] Error: ${error.message}`);
        // No exponer detalles internos al cliente
        res.status(500).json({
            error: 'Error interno al procesar la imagen. Intente nuevamente.'
        });
    }
});

// Health check (sin autenticación, es público)
app.get('/health', (req, res) => {
    res.json({
        status: visionReady ? 'ok' : 'degraded',
        vision: visionReady ? 'connected' : 'disconnected'
    });
});

// ──────────────────────────────────────────────
// INICIAR
// ──────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor OCR seguro en puerto ${PORT}`);
});
