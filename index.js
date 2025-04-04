const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const winston = require('winston');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5001;
let qrCodeImage = null;
let isConnected = false;

// Configuration des logs
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'whatsapp-bot.log' })
    ]
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
});

// // Gestion des événements WhatsApp
// client.on('qr', qr => {
//     logger.info('Nouveau QR Code généré');
//     qrcode.generate(qr, { small: true });
    
//     qrcode.toDataURL(qr, (err, url) => {
//         if (err) {
//             logger.error('Erreur lors de la génération du QR Code:', err);
//             return;
//         }
//         qrCodeImage = url;
//     });
// });


client.on('qr', async (qr) => {
    logger.info('📢 Nouveau QR Code généré');

    try {
        qrCodeImage = await qrcode.toDataURL(qr);
        logger.info('✅ QR Code converti en base64 avec succès');
    } catch (err) {
        logger.error(`❌ Erreur lors de la génération du QR Code: ${err}`);
    }
});


client.on('ready', () => {
    logger.info('✅ Bot WhatsApp connecté avec succès !');
    qrCodeImage = null;
    isConnected = true;
});

client.on('auth_failure', () => {
    logger.error('❌ Échec de l\'authentification');
    isConnected = false;
});

client.on('disconnected', (reason) => {
    logger.warn(`Déconnecté: ${reason}`);
    isConnected = false;
});

// Middleware
app.use(express.json());

// Routes API
app.get('/qrcode', (req, res) => {
    if (qrCodeImage) {
        res.json({ qr: qrCodeImage });
    } else {
        res.json({ message: isConnected ? "✅ Déjà connecté" : "Non générer"});
    }
});

app.get('/status', (req, res) => {
    res.json({ 
        status: isConnected ? "CONNECTED" : qrCodeImage ? "SCAN_QR" : "DISCONNECTED",
        isConnected,
        timestamp: new Date().toISOString()
    });
});

app.post('/send-message', async (req, res) => {
    if (!isConnected) {
        return res.status(400).json({ error: "Le client n'est pas connecté" });
    }

    const { groupName, message, mediaUrl } = req.body;

    if (!groupName || !message) {
        return res.status(400).json({ error: "groupName et message sont requis" });
    }

    try {
        const chats = await client.getChats();
        const group = chats.find(chat => 
            chat.isGroup && chat.name.toLowerCase() === groupName.toLowerCase()
        );

        if (!group) {
            return res.status(404).json({ error: `Groupe "${groupName}" introuvable` });
        }

        if (mediaUrl) {
            try {
                const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
                await group.sendMessage(media, { caption: message });
            } catch (mediaError) {
                logger.error(`Erreur lors du traitement du média: ${mediaError.message}`);
                await group.sendMessage(message);
            }
        } else {
            await group.sendMessage(message);
        }

        logger.info(`Message envoyé à "${groupName}"`);
        res.json({ 
            success: true, 
            message: `Message envoyé à "${groupName}"`,
            groupId: group.id._serialized
        });

    } catch (error) {
        logger.error(`Erreur lors de l'envoi du message: ${error.message}`);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.post('/disconnect', async (req, res) => {
    if (!isConnected) {
        return res.status(400).json({ error: "Le client n'est pas connecté" });
    }

    try {
        await client.logout();  // Déconnecte proprement WhatsApp Web
        isConnected = false;
        qrCodeImage = null;
        res.json({ success: true, message: "Déconnecté avec succès !" });
        logger.info("🛑 Bot WhatsApp déconnecté avec succès !");
    } catch (error) {
        logger.error("❌ Erreur lors de la déconnexion :", error);
        res.status(500).json({ success: false, message: "Erreur lors de la déconnexion." });
    }
});

// Gestion des erreurs 404
app.use((req, res) => {
    res.status(404).json({ error: "Endpoint non trouvé" });
});

// Initialisation
client.initialize()
    .catch(error => {
        logger.error('Erreur lors de l\'initialisation du client:', error);
    });

app.listen(PORT, () => {
    logger.info(`🚀 Serveur API lancé sur https://whatjscript.onrender.com`);
});

// Gestion des erreurs non catchées
process.on('unhandledRejection', error => {
    logger.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', error => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});
