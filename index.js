const express = require('express');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. CONFIGURACIÓN DE BASE DE DATOS (POSTGRES)
// ==========================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false 
    }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Error conectando a PostgreSQL:', err.stack);
    }
    console.log(`✅ Conexión exitosa a la base de datos: ${process.env.DB_NAME}`);
    release();
});

// ==========================================
// 2. CONFIGURACIÓN DE ALMACENAMIENTO (CLOUDINARY)
// ==========================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'samigomu_comprobantes', 
        allowed_formats: ['jpg', 'png', 'jpeg'], 
        transformation: [{ width: 800, height: 800, crop: 'limit' }] 
    },
});

const upload = multer({ storage: storage });

function obtenerPublicId(url) {
    if (!url || !url.includes('samigomu_comprobantes')) return null;
    try {
        const partes = url.split('/');
        const folderIndex = partes.indexOf('samigomu_comprobantes');
        if (folderIndex === -1) return null;
        
        const parteConExtension = partes.slice(folderIndex).join('/');
        return parteConExtension.split('.')[0]; 
    } catch (error) {
        console.error('❌ Error al extraer el Public ID:', error);
        return null;
    }
}
// ==========================================
// 3. MIDDLEWARES Y CONFIGURACIÓN GENERAL
// ==========================================
app.use(session({
    secret: process.env.SESSION_SECRET, 
    resave: false, 
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 2 // 2 horas de sesión segura
    }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Control de seguridad para rutas de administración
function requiereAutenticacion(req, res, next) {
    if (req.session && req.session.usuarioId) {
        return next();
    } else {
        res.redirect('/login');
    }
}

// Inicialización automática del usuario administrador seguro
async function verificarYCrearAdmin() {
    const usuarioAdmin = process.env.ADMIN_USER;
    const contrasenaClara = process.env.ADMIN_PASSWORD;
    const salRounds = 10;

    try {
        const existeAdmin = await pool.query('SELECT * FROM users WHERE username = $1', [usuarioAdmin]);
        if (existeAdmin.rows.length === 0) {
            const hash = await bcrypt.hash(contrasenaClara, salRounds);
            await pool.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [usuarioAdmin, hash]);
            console.log('📌 [Base de Datos]: Usuario administrador creado automáticamente por primera vez.');
        } else {
            console.log('📌 [Base de Datos]: Administrador verificado. Todo en orden.');
        }
    } catch (err) {
        console.error('❌ Error al verificar/crear el administrador permanente:', err.message);
    }
}

// ==========================================
// 4. RUTAS DEL FLUJO DE AUTENTICACIÓN
// ==========================================
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const query = 'SELECT * FROM users WHERE username = $1';
        const resultado = await pool.query(query, [username]);

        if (resultado.rows.length === 0) {
            return res.render('login', { error: 'Usuario o contraseña incorrectos.' });
        }

        const usuarioEncontrado = resultado.rows[0];
        const coinciden = await bcrypt.compare(password, usuarioEncontrado.password_hash);

        if (coinciden) {
            req.session.usuarioId = usuarioEncontrado.id;
            req.session.usuarioName = usuarioEncontrado.username;
            res.redirect('/admin');
        } else {
            res.render('login', { error: 'Usuario o contraseña incorrectos.' });
        }
    } catch (err) {
        console.error('Error en el login:', err.message);
        res.status(500).send('Error interno en el servidor.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// ==========================================
// 5. RUTAS DE LA VISTA DEL CLIENTE (E-COMMERCE)
// ==========================================
app.get('/', async (req, res) => {
    try {
        const query = await pool.query('SELECT * FROM products');
        res.render('index', { productos: query.rows });
    } catch (err) {
        console.error('Error al mostrar los productos:', err.message);
        res.status(500).send('Error en el servidor');
    }
});

app.get('/personalizar', async (req, res) => {
    const productoId = req.query.id;
    if (!productoId) return res.redirect('/');

    try {
        const resultado = await pool.query('SELECT * FROM products WHERE id = $1', [productoId]);
        if (resultado.rows.length === 0) {
            return res.status(404).send('Lo sentimos, ese amigurumi no existe en nuestro catálogo.');
        }
        res.render('personalizar', { producto: resultado.rows[0] });
    } catch (err) {
        console.error('Error al cargar la personalización:', err.message);
        res.status(500).send('Error en el servidor al cargar el producto.');
    }
});

app.post('/pedir', upload.single('payment_receipt'), async (req, res) => {
    const { 
        nombre_cliente, 
        telefono_cliente, 
        contacto_alternativo, 
        direccion_envio, 
        producto_id, 
        custom_size, 
        custom_colors, 
        custom_notes 
    } = req.body;

    if (!req.file) {
        return res.status(400).send('Es obligatorio subir el comprobante de pago para procesar el pedido.');
    }

    const urlComprobante = req.file.path; 
    const trackingCode = `SM-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const productoRes = await client.query('SELECT base_price FROM products WHERE id = $1', [producto_id]);
        if (productoRes.rows.length === 0) throw new Error('El amigurumi seleccionado no existe.');
        const precioTotal = productoRes.rows[0].base_price;

        const queryOrden = `
            INSERT INTO orders (
                tracking_code, 
                customer_name, 
                customer_phone, 
                alternative_contact, 
                shipping_address, 
                total_price, 
                payment_method, 
                payment_reference, 
                status, 
                payment_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'Transferencia', $7, 'Recibido', 'Pendiente')
            RETURNING id;
        `;
        
        const ordenRes = await client.query(queryOrden, [
            trackingCode,          
            nombre_cliente,      
            telefono_cliente,      
            contacto_alternativo,  
            direccion_envio,       
            precioTotal,           
            urlComprobante         
        ]);
        
        const nuevoOrdenId = ordenRes.rows[0].id;

        const queryItem = `
            INSERT INTO order_items (order_id, product_id, custom_size, custom_colors, custom_notes, quantity)
            VALUES ($1, $2, $3, $4, $5, 1);
        `;
        await client.query(queryItem, [nuevoOrdenId, producto_id, custom_size, custom_colors, custom_notes]);

        await client.query('COMMIT');
        res.redirect(`/pedido-exitoso?code=${trackingCode}`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al procesar el pedido:', err.message);
        res.status(500).send('Hubo un error al guardar tu pedido. Por favor intenta de nuevo.');
    } finally {
        client.release();
    }
});

app.get('/pedido-exitoso', (req, res) => {
    res.render('pedido-exitoso', { code: req.query.code });
});

app.get('/rastrear', (req, res) => {
    res.render('rastrear', { pedido: null, error: null, codigoBuscado: '' });
});

app.get('/rastrear/consultar', async (req, res) => {
    const { codigo } = req.query;
    if (!codigo) return res.redirect('/rastrear');

    try {
        const queryBusqueda = `
            SELECT o.tracking_code, o.status, o.customer_name, p.title AS producto_nombre
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN products p ON oi.product_id = p.id
            WHERE UPPER(o.tracking_code) = UPPER($1);
        `;
        const resultado = await pool.query(queryBusqueda, [codigo.trim()]);

        if (resultado.rows.length === 0) {
            return res.render('rastrear', { 
                pedido: null, 
                error: 'No encontramos ningún pedido con ese código.',
                codigoBuscado: codigo 
            });
        }
        res.render('rastrear', { pedido: resultado.rows[0], error: null, codigoBuscado: codigo });
    } catch (err) {
        console.error('Error al rastrear pedido:', err.message);
        res.status(500).send('Error interno al consultar el estado.');
    }
});

// ==========================================
// 6. CONTROL PANEL: GESTIÓN DE PEDIDOS (ADMIN)
// ==========================================
app.get('/admin', requiereAutenticacion, async (req, res) => {
    try {
        const query = `
            SELECT 
                o.id AS orden_id, o.tracking_code, o.customer_name, o.customer_phone, o.alternative_contact, o.shipping_address, o.status,
                o.total_price, o.created_at, o.payment_method, o.payment_reference, o.payment_status,
                p.title AS producto_nombre, oi.custom_size, oi.custom_colors, oi.custom_notes, oi.ref_image_url
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN products p ON oi.product_id = p.id
            ORDER BY o.created_at DESC;
        `;
        const resultado = await pool.query(query);
        
        // CONTADOR DINÁMICO DE PENDIENTES (Suma soporte a estados viejos y nuevos)
        const pendientes = resultado.rows.filter(p => p.status === 'Pendiente' || p.status === 'Recibido' || p.status === 'Tejiendo');
        const nuevosCount = [...new Set(pendientes.map(p => p.orden_id))].length;

        res.render('admin', { pedidos: resultado.rows, nuevosCount: nuevosCount });
    } catch (err) {
        console.error('Error al cargar el panel de admin:', err.message);
        res.status(500).send('Error en el servidor al cargar el panel.');
    }
});

app.post('/admin/pedido/actualizar-estado/:id', requiereAutenticacion, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; 

        await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
        res.redirect('/admin');
    } catch (err) {
        console.error('Error al actualizar estado:', err.message);
        res.status(500).send('Error interno al actualizar el estado.');
    }
});

app.post('/admin/productos/eliminar', requiereAutenticacion, async (req, res) => {
    const { producto_id } = req.body;
    console.log("📌 [Admin]: Intentando eliminar producto ID:", producto_id);
    
    try {
        const prodRes = await pool.query('SELECT image_url FROM products WHERE id = $1', [producto_id]);
        
        if (prodRes.rows.length === 0) {
            console.log("⚠️ [Admin]: No se encontró el producto en la base de datos.");
            return res.redirect('/admin/productos?error=not_found');
        }

        await pool.query('UPDATE order_items SET product_id = NULL WHERE product_id = $1', [producto_id]);

        await pool.query('DELETE FROM products WHERE id = $1', [producto_id]);
        console.log("✅ [Base de Datos]: Producto eliminado con éxito.");
        
        if (prodRes.rows[0].image_url) {
            const publicId = obtenerPublicId(prodRes.rows[0].image_url);
            console.log("🧹 [Cloudinary]: Intentando destruir Public ID:", publicId);
            if (publicId) {
                const resultadoCloudinary = await cloudinary.uploader.destroy(publicId);
                console.log("☁️ [Cloudinary Status]:", resultadoCloudinary);
            }
        }

        res.redirect('/admin/productos?success=deleted'); 
    } catch (err) {
        console.error('❌ [Error Crítico]:', err.message);
        res.status(500).send('No se pudo eliminar el producto de forma segura.');
    }
});

app.post('/admin/delete-order', requiereAutenticacion, async (req, res) => {
    const { order_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const buscarImagenes = await client.query(`
            SELECT o.payment_reference, oi.ref_image_url 
            FROM orders o 
            LEFT JOIN order_items oi ON o.id = oi.order_id 
            WHERE o.id = $1
        `, [order_id]);

        await client.query('DELETE FROM order_items WHERE order_id = $1', [order_id]);
        await client.query('DELETE FROM orders WHERE id = $1', [order_id]);
        
        await client.query('COMMIT');

        if (buscarImagenes.rows.length > 0) {
            for (const fila of buscarImagenes.rows) {
                if (fila.payment_reference) {
                    const idRef = obtenerPublicId(fila.payment_reference);
                    if (idRef) await cloudinary.uploader.destroy(idRef);
                }
                if (fila.ref_image_url) {
                    const idImg = obtenerPublicId(fila.ref_image_url);
                    if (idImg) await cloudinary.uploader.destroy(idImg);
                }
            }
        }

        res.redirect('/admin');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error al eliminar el pedido:', err.message);
        res.status(500).send('No se pudo eliminar el pedido correctamente.');
    } finally {
        client.release();
    }
});

// ==========================================
// 7. CONTROL PANEL: GESTIÓN DE CATÁLOGO (PRODUCTS)
// ==========================================
app.get('/admin/productos', requiereAutenticacion, async (req, res) => {
    try {
        const query = await pool.query('SELECT * FROM products ORDER BY id DESC');
        
        let alerta = null;
        if (req.query.success === 'added') alerta = '✨ ¡Amigurumi publicado con éxito!';
        if (req.query.success === 'deleted') alerta = '🗑️ El producto ha sido eliminado.';
        if (req.query.success === 'updated') alerta = '✏️ ¡Los cambios del amigurumi se guardaron!';

        res.render('admin-productos', { productos: query.rows, alerta: alerta });
    } catch (err) {
        console.error('Error al cargar el catálogo de admin:', err.message);
        res.status(500).send('Error en el servidor al cargar el catálogo.');
    }
});

app.post('/admin/productos/agregar', requiereAutenticacion, upload.single('image_file'), async (req, res) => {
    try {
        const { title, base_price, description } = req.body;
        if (!req.file) return res.status(400).send('Es obligatorio subir una foto para el nuevo producto.');

        const image_url = req.file.path; 
        await pool.query(
            'INSERT INTO products (title, base_price, image_url, description) VALUES ($1, $2, $3, $4)',
            [title, base_price, image_url, description]
        );
        res.redirect('/admin/productos?success=added');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al agregar el producto.');
    }
});

app.post('/admin/productos/editar/:id', requiereAutenticacion, upload.single('image_file'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, base_price, description } = req.body;

        if (req.file) {
            const prodAntiguo = await pool.query('SELECT image_url FROM products WHERE id = $1', [id]);
            if (prodAntiguo.rows.length > 0 && prodAntiguo.rows[0].image_url) {
                const oldPublicId = obtenerPublicId(prodAntiguo.rows[0].image_url);
                if (oldPublicId) await cloudinary.uploader.destroy(oldPublicId);
            }

            const image_url = req.file.path;
            await pool.query(
                'UPDATE products SET title = $1, base_price = $2, image_url = $3, description = $4 WHERE id = $5',
                [title, base_price, image_url, description, id]
            );
        } else {
            await pool.query(
                'UPDATE products SET title = $1, base_price = $2, description = $3 WHERE id = $4',
                [title, base_price, description, id]
            );
        }
        res.redirect('/admin/productos?success=updated');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al editar el producto.');
    }
});

app.get('/pedido-personalizado', (req, res) => {
    res.render('pedido-personalizado');
});

app.post('/pedido-personalizado', upload.single('reference_image'), async (req, res) => {
    const { nombre_cliente, telefono_cliente, correo_cliente, metodo_contacto, custom_notes } = req.body;

    if (!req.file) {
        return res.status(400).send('Es obligatorio subir una imagen de referencia.');
    }

    const urlImagenReferencia = req.file.path; 
    
    const trackingCode = `C-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const client = await pool.connect();

    const notasConsolidadas = `👉 CONTACTAR POR: ${metodo_contacto} \n📧 Correo: ${correo_cliente} \n💡 Idea: ${custom_notes}`;

    try {
        await client.query('BEGIN');

        const queryOrden = `
            INSERT INTO orders (tracking_code, customer_name, customer_phone, total_price, payment_method, status, payment_status)
            VALUES ($1, $2, $3, 0.00, 'Manual', 'Cotizar', 'Pendiente')
            RETURNING id;
        `;
        const ordenRes = await client.query(queryOrden, [trackingCode, nombre_cliente, telefono_cliente]);
        const nuevoOrdenId = ordenRes.rows[0].id;

        const queryItem = `
            INSERT INTO order_items (order_id, product_id, custom_size, custom_colors, custom_notes, ref_image_url, quantity)
            VALUES ($1, NULL, 'Manual', 'Manual', $2, $3, 1);
        `;
        await client.query(queryItem, [nuevoOrdenId, notasConsolidadas, urlImagenReferencia]);

        await client.query('COMMIT');
        res.redirect(`/pedido-exitoso?code=${trackingCode}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al procesar el diseño personalizado:', err.message);
        res.status(500).send('Hubo un error al enviar tu solicitud.');
    } finally {
        client.release();
    }
});



app.listen(PORT, async () => {
    console.log(`🚀 Servidor corriendo en: http://localhost:${PORT}`);
    await verificarYCrearAdmin();
});