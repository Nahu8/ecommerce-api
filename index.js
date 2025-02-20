require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(cors());

// Configurar Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configurar Multer para manejar la subida de archivos
const upload = multer({ dest: 'uploads/' });

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    port: process.env.MYSQL_PORT
});



// Verificar conexión a MySQL
pool.getConnection()
    .then(conn => {
        console.log('✅ Conexión a MySQL exitosa');
        conn.release();
    })
    .catch(err => console.error('❌ Error al conectar a MySQL:', err));


// Crear Superadmin si no existe
const crearSuperadmin = async () => {
    try {
        const [rows] = await pool.query("SELECT * FROM usuarios WHERE username = ?", ['admin']);
        if (rows.length === 0) {
            const passwordHash = await bcrypt.hash('admin123', 10);
            await pool.query("INSERT INTO usuarios (username, password) VALUES (?, ?)", ['admin', passwordHash]);
            console.log('✅ Superadmin creado');
        }
    } catch (error) {
        console.error('❌ Error al crear Superadmin:', error);
    }
};
crearSuperadmin();

// Login de usuario
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.query("SELECT * FROM usuarios WHERE username = ?", [username]);
        if (rows.length === 0) return res.status(400).json({ error: 'Usuario no encontrado' });
        
        const validPass = await bcrypt.compare(password, rows[0].password);
        if (!validPass) return res.status(400).json({ error: 'Contraseña incorrecta' });
        
        // Se incluye el username en el payload además del id
        res.json({ mensaje: 'Usuario autenticado correctamente' });
    } catch (error) {
        console.error('Error en el login:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// Obtener productos (sin autenticación requerida)
app.get('/productos', async (req, res) => {
    try {
        const [productos] = await pool.query("SELECT * FROM productos");
        res.json(productos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// Crear producto con imagen (SIN autenticación requerida)
app.post('/productos', upload.single('imagen'), async (req, res) => {
    const { nombre, descripcion, precio } = req.body;
    const imagen = req.file;

    // Validar que se haya subido una imagen
    if (!imagen) {
        return res.status(400).json({ error: 'No se proporcionó una imagen' });
    }

    try {
        // Subir la imagen a Cloudinary
        const result = await cloudinary.uploader.upload(imagen.path);

        // Insertar el producto en la base de datos con la URL de la imagen
        await pool.query(
            "INSERT INTO productos (nombre, descripcion, precio, imagen_url) VALUES (?, ?, ?, ?)",
            [nombre, descripcion, precio, result.secure_url]
        );

        res.json({ mensaje: 'Producto creado correctamente', imagen_url: result.secure_url });
    } catch (error) {
        console.error('Error al crear producto:', error);
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// Editar producto por ID (incluye actualización de imagen opcional)
app.put('/productos/:id', upload.single('imagen'), async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio } = req.body;
    const imagen = req.file;

    try {
        // Obtener la URL de la imagen actual en caso de no actualizarla
        const [producto] = await pool.query("SELECT imagen_url FROM productos WHERE id = ?", [id]);
        if (producto.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        let imagenUrl = producto[0].imagen_url;

        // Si se proporciona una nueva imagen, subirla a Cloudinary
        if (imagen) {
            const result = await cloudinary.uploader.upload(imagen.path);
            imagenUrl = result.secure_url;
        }

        // Actualizar el producto en la base de datos
        const [result] = await pool.query(
            "UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, imagen_url = ? WHERE id = ?",
            [nombre, descripcion, precio, imagenUrl, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        res.json({ mensaje: 'Producto actualizado correctamente', imagen_url: imagenUrl });

    } catch (error) {
        console.error('Error al actualizar producto:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// Eliminar producto por ID
app.delete('/productos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await pool.query("DELETE FROM productos WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        res.json({ mensaje: 'Producto eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar producto:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// Configurar el transporter de nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'gastoncastillo2990@gmail.com',  // Tu correo electrónico
        pass: 'laew wppi ewer zjqs'   // Tu contraseña de aplicación
    }
});

// Endpoint para enviar correos
app.post('/enviar-correo', (req, res) => {
    const { email, producto, cantidad, alias, direccion, celular, nombre } = req.body;

    const mailOptions = {
        from: process.env.EMAIL_USER, // Correo del remitente
        to: email, // Correo del destinatario
        subject: 'CASTLE CLOTHING | Detalles de tu compra', // Asunto del correo
        html: `
            <h1>¡Gracias por tu compra, ${nombre}!</h1>
            <p>Has comprado el siguiente producto:</p>
            <ul>
                <li><strong>Producto:</strong> ${producto.nombre}</li>
                <li><strong>Descripción:</strong> ${producto.descripcion}</li>
                <li><strong>Precio:</strong> ${producto.precio}</li>
            </ul>
            <p><strong>Cantidad:</strong> ${cantidad}</p>
            <p><strong>Dirección de envío:</strong> ${direccion}</p>
            <p><strong>Número de celular:</strong> ${celular}</p>
            <p>Para finalizar la compra, transfiere <strong>${cantidad * producto.precio}</strong> a este alias: <strong>${alias}</strong>.</p>
            <p>¡Gracias por elegirnos!</p>

            <h3>El envío comenzará 72 horas después de abonar la compra.</h3>

            <h2>Castle Clothing...<h2>
        `,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Error al enviar el correo:', error);
            return res.status(500).json({ error: 'Error al enviar el correo' });
        }
        console.log('Correo enviado:', info.response);
        res.json({ mensaje: 'Correo enviado correctamente' });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor corriendo en el puerto ${PORT}`));

