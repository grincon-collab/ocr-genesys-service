const express = require('express');
const vision = require('@google-cloud/vision');
const app = express();

// Genesys envía Base64 largos, permitimos hasta 10MB
app.use(express.json({ limit: '10mb' }));

// 1. Configuración de Google Vision con tu JSON de variables de entorno
let client;
try {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    console.log("Contenido de la variable:", rawCreds ? "Recibida (OK)" : "VACÍA (UNDEFINED)");
    const credentials = JSON.parse(rawCreds);
    client = new vision.ImageAnnotatorClient({ credentials });
    console.log("✅ Conectado a Google Cloud Vision: " + credentials.project_id);
} catch (error) {
    console.error("❌ Error detallado:", error.message);
}

// ============================================================
// MÓDULO DE VALIDACIÓN DE DOCUMENTO - ESTILO AGENTE GUBERNAMENTAL
// ============================================================

/**
 * Palabras clave que DEBEN estar presentes en un documento de identidad colombiano.
 * Se busca al menos un mínimo de coincidencias para considerar que es un documento real.
 */
const PALABRAS_CLAVE_DOCUMENTO = [
    'REPUBLICA',
    'COLOMBIA',
    'CEDULA',
    'CIUDADANIA',
    'APELLIDO',
    'NOMBRE',
    'FECHA',
    'NACIMIENTO',
    'LUGAR',
    'REGISTRADURIA',
    'IDENTIFICACION',
    'NUIP',
];

/**
 * Patrones sospechosos que indican que NO es un documento válido.
 * (facturas, recibos, capturas de pantalla, etc.)
 */
const PATRONES_NO_DOCUMENTO = [
    'FACTURA', 'INVOICE', 'RECIBO', 'TOTAL', 'SUBTOTAL',
    'PRECIO', 'PAGO', 'TRANSFERENCIA', 'NEQUI', 'DAVIPLATA',
    'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'TWITTER', 'TIKTOK',
    'MENU', 'RESTAURANTE', 'DESCUENTO', 'IVA', 'COMPRA',
    'CONTRASEÑA', 'PASSWORD', 'LOGIN', 'USUARIO',
    'WIFI', 'SSID', 'HTTP', 'WWW', '.COM', '.CO',
];

/**
 * Valida si el texto extraído corresponde a un documento de identidad colombiano.
 * Retorna { esValido: boolean, razon: string }
 * 
 * CRITERIOS (estilo agente gubernamental):
 *   1. Debe tener suficiente texto (no puede ser una imagen vacía o un garabato)
 *   2. Debe contener palabras clave de un documento de identidad
 *   3. Debe contener un número que parezca una cédula (7 a 11 dígitos)
 *   4. No debe contener patrones que delaten otro tipo de documento
 *   5. Debe tener una estructura mínima de líneas (un documento real tiene varias líneas)
 */
function validarDocumentoIdentidad(textoCompleto, lineas) {
    // --- CRITERIO 1: Texto suficiente ---
    if (!textoCompleto || textoCompleto.length < 30) {
        return {
            esValido: false,
            razon: "No se detectó texto suficiente en la imagen. Asegúrate de enviar una foto clara de tu documento de identidad."
        };
    }

    // --- CRITERIO 2: Mínimo de líneas (un documento real tiene estructura) ---
    if (lineas.length < 4) {
        return {
            esValido: false,
            razon: "La imagen no tiene la estructura de un documento de identidad. Debe contener varias líneas de información."
        };
    }

    const textoUpper = textoCompleto.toUpperCase();

    // --- CRITERIO 3: Detectar si es otro tipo de documento (no una cédula) ---
    let contadorSospechoso = 0;
    const palabrasSospechosasEncontradas = [];
    for (const patron of PATRONES_NO_DOCUMENTO) {
        if (textoUpper.includes(patron)) {
            contadorSospechoso++;
            palabrasSospechosasEncontradas.push(patron);
        }
    }
    // Si tiene 2+ palabras sospechosas, muy probablemente NO es una cédula
    if (contadorSospechoso >= 2) {
        console.log("⚠️ Palabras sospechosas detectadas:", palabrasSospechosasEncontradas.join(', '));
        return {
            esValido: false,
            razon: "La imagen parece ser otro tipo de documento (factura, recibo, captura de pantalla, etc.). Por favor, envía únicamente tu cédula de ciudadanía."
        };
    }

    // --- CRITERIO 4: Debe contener palabras clave de documento de identidad ---
    let coincidenciasDocumento = 0;
    const palabrasEncontradas = [];
    for (const palabra of PALABRAS_CLAVE_DOCUMENTO) {
        if (textoUpper.includes(palabra)) {
            coincidenciasDocumento++;
            palabrasEncontradas.push(palabra);
        }
    }

    console.log(`🔍 Palabras clave de documento encontradas (${coincidenciasDocumento}/${PALABRAS_CLAVE_DOCUMENTO.length}):`, palabrasEncontradas.join(', '));

    // Necesitamos al menos 3 coincidencias para considerar que es un documento real
    if (coincidenciasDocumento < 3) {
        return {
            esValido: false,
            razon: "La imagen no parece ser un documento de identidad colombiano válido. Asegúrate de enviar una foto completa y legible de tu cédula de ciudadanía."
        };
    }

    // --- CRITERIO 5: Debe haber un número que parezca cédula (7-11 dígitos) ---
    const soloDigitos = textoCompleto.replace(/\D/g, '');
    const tieneCedula = /\d{7,11}/.test(soloDigitos);
    if (!tieneCedula) {
        return {
            esValido: false,
            razon: "No se detectó un número de cédula válido en el documento. Asegúrate de que el número de identificación sea visible y legible."
        };
    }

    // ✅ Pasó todos los filtros
    return { esValido: true, razon: null };
}

// ============================================================
// ENDPOINT PRINCIPAL (ESTRUCTURA DE RESPUESTA SIN CAMBIOS)
// ============================================================

app.post('/api/extract', async (req, res) => {
    try {
        const { ocrBase64 } = req.body;

        if (!ocrBase64) {
            return res.status(400).json({ error: "Falta el campo ocrBase64" });
        }

        // 2. Convertir Base64 a Buffer
        const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // --- INICIO FASE 2.5: FILTRO DE CALIDAD "NINJA" ---
        // Filtro de Tamaño Físico (Rechaza si pesa menos de 40 KB)
        const sizeInKB = imageBuffer.length / 1024;
        if (sizeInKB < 40) {
            console.log("⚠️ Imagen rechazada por tamaño miniatura:", sizeInKB.toFixed(2), "KB");
            return res.json({ 
                calidadAprobada: false, 
                mensajeRechazo: "La imagen es muy pequeña o es una miniatura. Por favor, toma la foto más de cerca." 
            });
        }

        // Ejecutar Google Cloud Vision (UNA SOLA LLAMADA para todo)
        const [result] = await client.textDetection(imageBuffer);
        
        // Filtro de Claridad (Confidence Score de Google)
        let confidence = 0;
        if (result.fullTextAnnotation && result.fullTextAnnotation.pages.length > 0) {
            confidence = result.fullTextAnnotation.pages[0].confidence || 0; 
        }

        // Si Google está menos del 80% (0.80) seguro, significa que está borrosa
        if (confidence > 0 && confidence < 0.80) {
             console.log("⚠️ Imagen rechazada por baja calidad/borrosa. Score:", confidence);
             return res.json({ 
                calidadAprobada: false, 
                mensajeRechazo: "La foto está borrosa o tiene reflejos de luz. Por favor, tómala de nuevo." 
            });
        }
        // --- FIN FASE 2.5 ---

        // 3. Separar el texto línea por línea y limpiarlo
        const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
        const lineas = text.split('\n').map(l => l.trim().toUpperCase()).filter(l => l !== '');

        // --- FASE 3: VALIDACIÓN DE DOCUMENTO ESTILO AGENTE GUBERNAMENTAL ---
        const validacion = validarDocumentoIdentidad(text, lineas);
        if (!validacion.esValido) {
            console.log("🚫 Documento rechazado:", validacion.razon);
            return res.json({
                calidadAprobada: false,
                mensajeRechazo: validacion.razon
            });
        }
        console.log("✅ Documento validado como cédula de ciudadanía colombiana");
        // --- FIN FASE 3 ---

        // --- FASE 2: EXTRACCIÓN AVANZADA (SIN CAMBIOS) ---
        
        // A. Extraer Cédula
        const soloNumeros = text.replace(/\D/g, ''); 
        const match = soloNumeros.match(/\d{7,11}/);
        const cedulaExtraida = match ? match[0] : "No detectada";

        // B. Extraer Apellidos 
        let apellidosExtraidos = "No detectados";
        const idxApellidos = lineas.findIndex(l => l.includes('APELLIDO'));
        if (idxApellidos > 0) {
            apellidosExtraidos = lineas[idxApellidos - 1]; 
        }

        // C. Extraer Nombres
        let nombresExtraidos = "No detectados";
        const idxNombres = lineas.findIndex(l => l.includes('NOMBRE'));
        if (idxNombres > 0) {
            nombresExtraidos = lineas[idxNombres - 1];
        }

        // 4. Preparamos y enviamos la respuesta (MISMA ESTRUCTURA EXACTA)
        const respuestaFinal = {
            calidadAprobada: true,
            cedula: cedulaExtraida,
            nombres: nombresExtraidos,
            apellidos: apellidosExtraidos
        };

        console.log("=== ENVIANDO A GENESYS ===");
        console.log(respuestaFinal);

        res.json(respuestaFinal);

    } catch (error) {
        console.error("Error en OCR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Arrancar el servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor OCR de Google listo en puerto ${PORT}`);
});
