        /* =============================================
           PRELOADER ANTI-CUELGUE
           ============================================= */
        function ocultarPreloader() {
            const preloader = document.getElementById('preloader');
            if (preloader && preloader.style.display !== 'none') {
                preloader.classList.add('preloader--hidden');
                setTimeout(() => { preloader.style.display = 'none'; }, 500);
            }
        }
        window.addEventListener('load', () => setTimeout(ocultarPreloader, 300));
        // Fallback: Forzamos sí o sí ocultar preloader a los 2.5s, pase lo que pase
        setTimeout(ocultarPreloader, 2500);
        /* =============================================
           CONFIG — Cambia estos valores
           ============================================= */
        const CONFIG = {
            /* URL de tu API SheetDB (conectada a Google Sheets) */
            sheetdb_url: 'https://sheetdb.io/api/v1/gh45ydwn5vaiz',

            /* Número de WhatsApp (con código de país, sin + ni espacios) */
            whatsapp_numero: '584120708031',

            /* Horario de la tienda (formato 24h) */
            hora_apertura: 7,
            hora_cierre: 20,

            /* Valor por defecto del dólar si la API falla */
            dolar_fallback: 36.60
        };

        /* =============================================
           RED (Fetch Timeout)
           ============================================= */
        async function fetchWithTimeout(resource, options = {}) {
            const { timeout = 4000 } = options;
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            try {
                const response = await fetch(resource, { ...options, signal: controller.signal });
                clearTimeout(id);
                return response;
            } catch (error) {
                clearTimeout(id);
                throw error;
            }
        }

        /* =============================================
           HONEYPOT Y SANITIZACIÓN (Seguridad)
           ============================================= */

        /**
         * sanitizeText — Elimina caracteres peligrosos que podrían
         * inyectar scripts o manipular el mensaje de WhatsApp (XSS).
         * Limpia: etiquetas HTML, comillas, backslashes, caracteres de control.
         */
        function sanitizeText(valor) {
            if (typeof valor !== 'string') return '';
            return valor
                .replace(/</g, '')         // Elimina apertura de tag HTML
                .replace(/>/g, '')         // Elimina cierre de tag HTML
                .replace(/&/g, 'y')        // Ampersand -> 'y' (seguro en URL)
                .replace(/"/g, '')         // Comillas dobles
                .replace(/'/g, '')         // Comillas simples
                .replace(/\\/g, '')        // Backslash
                .replace(/[\x00-\x1F\x7F]/g, '') // Caracteres de control ASCII
                .trim();
        }

        /**
         * isHoneypotLleno — Retorna true si el campo honeypot invisible fué rellenado.
         * Los bots suelen rellenar todos los campos; los usuarios reales no ven este campo.
         */
        function isHoneypotLleno() {
            const hp = document.getElementById('hp_email_campo');
            return hp && hp.value.length > 0;
        }


        /* =============================================
           MAPEO DE DATOS DESDE SHEETDB (JSON)
           Columnas de la hoja: id, name, price, type, img, desc, likes, stock
           ============================================= */
        function mapear_productos_sheetdb(datos_json) {
            return datos_json.map((item, i) => {
                const stock_val = item.stock || '';
                const stock_num = stock_val !== '' ? parseInt(stock_val) : 100;

                let addons_arr = [];
                if (item.addons) {
                    addons_arr = item.addons.split('|').map(a => {
                        const partes = a.split(':');
                        return partes.length === 2 ? { nombre: partes[0].trim(), precio: parseFloat(partes[1]) } : null;
                    }).filter(a => a !== null);
                }

                return {
                    id: parseInt(item.id) || (i + 1),
                    nombre: item.name || 'Sin nombre',
                    precio: parseFloat(item.price) || 0,
                    categoria: capitalizar_tipo(item.type || 'General'),
                    descripcion: item.desc || '',
                    disponible: stock_num > 0,
                    stock: stock_num,
                    badge: item.badge || null,
                    addons_posibles: addons_arr,
                    imagen: item.img || 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&q=80&w=400'
                };
            });
        }

        /* Capitaliza el tipo para mostrar bonito en los filtros */
        function capitalizar_tipo(tipo) {
            const mapa = {
                'pizzas': 'Pizzas',
                'dulces': 'Dulces',
                'comida rapida': 'Comida Rápida',
                'lacteos/pan': 'Lácteos/Pan',
                'burger': 'Hamburguesas',
                'side': 'Acompañantes',
                'drink': 'Bebidas'
            };
            return mapa[tipo.toLowerCase()] || tipo.charAt(0).toUpperCase() + tipo.slice(1);
        }

        /* =============================================
           PRODUCTOS POR DEFECTO (si no hay Google Sheet)
           ============================================= */
        const PRODUCTOS_DEFAULT = [
            { id: 1, nombre: 'Pizza Margarita Sello', precio: 10, categoria: 'Pizzas', descripcion: 'Masa artesanal de la casa, mozzarella fresca y albahaca. Horneada con amor.', disponible: true, stock: 100, badge: '🔥 El más pedido', addons_posibles: [{ nombre: 'Extra Queso', precio: 1.5 }], imagen: 'https://images.unsplash.com/photo-1574071318508-1cdbad80ad50?q=80&w=600' },
            { id: 2, nombre: 'Pizza Pepperoni Especial', precio: 12, categoria: 'Pizzas', descripcion: 'Pepperoni premium sobre base de salsa casera y queso gratinado.', disponible: true, stock: 2, badge: '✨ Top', addons_posibles: [{ nombre: 'Borde de Queso', precio: 2 }], imagen: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?q=80&w=600' },
            { id: 3, nombre: 'Empanadas (3 uds)', precio: 4, categoria: 'Comida Rápida', descripcion: 'Rellenos variados: queso, carne mechada o pollo.', disponible: false, stock: 0, addons_posibles: [], imagen: 'https://images.unsplash.com/photo-1601050690117-94f5f6fa8bd7?q=80&w=600' }
        ];

        /* =============================================
           APP PRINCIPAL (ALPINE.JS)
           ============================================= */
        function tienda() {
            return {
                /* --- Estado --- */
                carrito_abierto: false,
                filtro_activo: 'Todos',
                es_delivery: true,
                dolar_bcv: 0,

                meta_envio_gratis: 20,
                cobrar_delivery: true,
                zonas_disponibles: [], // Se llenará desde Google Sheets (config)
                zona_delivery: '',

                nombre_cliente: '',
                direccion: '',
                referencia: '',

                categorias: ['Todos'],
                productos: [],
                carrito: [],
                cargando: true,
                tienda_abierta: true,

                /* --- Inicialización --- */
                async inicializar() {
                    this.verificar_horario();

                    /* Cargar caché de LocalStorage (Progreso guardado) */
                    const caché_cliente = localStorage.getItem('canaan_cliente');
                    if (caché_cliente) {
                        const parsed = JSON.parse(caché_cliente);
                        this.nombre_cliente = parsed.n || '';
                        this.direccion = parsed.d || '';
                        this.referencia = parsed.r || '';
                        this.zona_delivery = parsed.z || '';
                    }

                    const caché_carrito = localStorage.getItem('canaan_carrito');
                    if (caché_carrito) this.carrito = JSON.parse(caché_carrito);

                    const caché_productos = localStorage.getItem('canaan_productos');
                    if (caché_productos) {
                        this.productos = JSON.parse(caché_productos);
                        this.extraer_categorias();
                        this.cargando = false;
                    }

                    /* Tareas de Red */
                    await this.cargar_configuracion();
                    await this.cargar_productos();
                },

                verificar_horario() {
                    const hora = new Date().getHours();
                    this.tienda_abierta = hora >= CONFIG.hora_apertura && hora < CONFIG.hora_cierre;
                },

                async cargar_configuracion() {
                    try {
                        const res = await fetchWithTimeout(CONFIG.sheetdb_url + '?sheet=config', { timeout: 4000 });
                        const data = await res.json();

                        /* ─────────────────────────────────────────────────────────
                           FUNCIÓN AUXILIAR: Busca un valor en dos formatos posibles
                           • Formato A (filas separadas): { clave:'dolar_bcv', valor:'500' }
                           • Formato B (columnas extra):  { clave:'dolar_bcv', valor:'500', habilitar_delivery:'no' }
                           ───────────────────────────────────────────────────────── */
                        const get = (clave) => {
                            const fila = data.find(d => d.clave === clave);
                            if (fila && fila.valor !== undefined && fila.valor.toString().trim() !== '') return fila.valor.toString().trim();
                            for (const f of data) {
                                if (f[clave] !== undefined && f[clave].toString().trim() !== '') return f[clave].toString().trim();
                            }
                            return null;
                        };

                        // --- Dólar BCV ---
                        const val_dolar = get('dolar_bcv');
                        if (val_dolar) {
                            const n = parseFloat(val_dolar.replace(',', '.'));
                            this.dolar_bcv = isNaN(n) ? CONFIG.dolar_fallback : n;
                        } else {
                            this.dolar_bcv = CONFIG.dolar_fallback;
                        }

                        // --- Delivery On/Off ---
                        const val_delivery = get('habilitar_delivery');
                        if (val_delivery !== null) {
                            const off = val_delivery === '0' || val_delivery.toLowerCase() === 'no' || val_delivery.toLowerCase() === 'false';
                            this.cobrar_delivery = !off;
                            if (!this.cobrar_delivery) this.es_delivery = false;
                        } else {
                            this.cobrar_delivery = true;
                        }

                        // --- Zonas (Ej: "Centro:1 | La Belén:1.5") ---
                        const val_zonas = get('zonas_delivery');
                        if (val_zonas) {
                            this.zonas_disponibles = val_zonas.split('|').map(z => {
                                const p = z.split(':');
                                return p.length === 2 ? { nombre: p[0].trim(), precio: parseFloat(p[1]) } : null;
                            }).filter(z => z !== null);
                        } else {
                            this.zonas_disponibles = []; // Sin zonas hasta que el usuario las configure en Google Sheets
                        }

                    } catch (e) {
                        this.dolar_bcv = CONFIG.dolar_fallback;
                        this.cobrar_delivery = true;
                        this.zonas_disponibles = []; // Sin zonas por defecto en caso de error
                    }
                },

                async cargar_productos() {
                    if (CONFIG.sheetdb_url) {
                        try {
                            const res = await fetchWithTimeout(CONFIG.sheetdb_url, { timeout: 4000 });
                            const data = await res.json();
                            this.productos = mapear_productos_sheetdb(data);
                            localStorage.setItem('canaan_productos', JSON.stringify(this.productos));
                        } catch (e) {
                            console.warn('Error cargando SheetDB, usando productos por defecto:', e);
                            if (this.productos.length === 0) this.productos = PRODUCTOS_DEFAULT;
                        }
                    } else {
                        this.productos = PRODUCTOS_DEFAULT;
                    }
                    this.extraer_categorias();
                    this.cargando = false;
                },

                extraer_categorias() {
                    const cats_unicas = [...new Set(this.productos.map(p => p.categoria))];
                    this.categorias = ['Todos', ...cats_unicas];
                },

                productos_filtrados() {
                    if (this.filtro_activo === 'Todos') return this.productos;
                    return this.productos.filter(p => p.categoria === this.filtro_activo);
                },

                /* --- Estado y Caché --- */
                guardar_carrito() {
                    localStorage.setItem('canaan_carrito', JSON.stringify(this.carrito));
                },

                guardar_datos_cliente() {
                    localStorage.setItem('canaan_cliente', JSON.stringify({
                        n: this.nombre_cliente, d: this.direccion,
                        r: this.referencia, z: this.zona_delivery
                    }));
                },

                /* --- Carrito y Addons --- */
                toggle_addon(index, addon) {
                    const item = this.carrito[index];
                    if (!item.addons_activos) item.addons_activos = [];
                    const idx = item.addons_activos.findIndex(a => a.nombre === addon.nombre);
                    if (idx > -1) {
                        item.addons_activos.splice(idx, 1);
                    } else {
                        item.addons_activos.push(addon);
                    }
                    this.guardar_carrito();
                },

                addon_esta_activo(index, addon) {
                    const item = this.carrito[index];
                    if (!item.addons_activos) return false;
                    return item.addons_activos.some(a => a.nombre === addon.nombre);
                },

                agregar_al_carrito(producto) {
                    if (!producto.disponible) return;

                    const ya_existe = this.carrito.find(c => c.id === producto.id && (!c.addons_activos || c.addons_activos.length === 0));

                    if (ya_existe) {
                        ya_existe.cantidad++;
                    } else {
                        this.carrito.push({ ...producto, cantidad: 1, nota: '', addons_activos: [] });
                    }
                    this.guardar_carrito();

                    // Animar el contador del carrito flotante (sin abrir el panel)
                    const contador = document.querySelector('.boton_carrito_flotante__contador');
                    if (contador) {
                        contador.classList.remove('bounce');
                        void contador.offsetWidth; // forzar reflow
                        contador.classList.add('bounce');
                    }

                    // Mostrar Toast Notificación
                    const toast = document.getElementById('toast_carrito');
                    const toastMsg = document.getElementById('toast_mensaje');
                    if (toast && toastMsg) {
                        toastMsg.textContent = `Añadiste ${producto.nombre}`;
                        toast.classList.add('mostrar');
                        
                        // Limpiar timeout anterior si existe para evitar pestañeos
                        if (window.toastTimeout) clearTimeout(window.toastTimeout);
                        window.toastTimeout = setTimeout(() => {
                            toast.classList.remove('mostrar');
                        }, 2500);
                    }
                },

                actualizar_cantidad(index, cambio) {
                    const nueva_cantidad = this.carrito[index].cantidad + cambio;
                    if (nueva_cantidad > 0) this.carrito[index].cantidad = nueva_cantidad;
                    this.guardar_carrito();
                },

                quitar_item(index) {
                    this.carrito.splice(index, 1);
                    this.guardar_carrito();
                },

                get total_items() {
                    return this.carrito.reduce((sum, i) => sum + i.cantidad, 0);
                },

                /* --- Precios Dinámicos --- */
                subtotal_items() {
                    return this.carrito.reduce((sum, item) => {
                        let extra_precio = 0;
                        if (item.addons_activos) {
                            extra_precio = item.addons_activos.reduce((s, a) => s + (a.precio || 0), 0);
                        }
                        return sum + ((item.precio + extra_precio) * item.cantidad);
                    }, 0);
                },

                costo_delivery() {
                    if (!this.es_delivery) return 0;
                    if (!this.cobrar_delivery) return 0;
                    if (this.porcentaje_envio_gratis() >= 100) return 0;
                    if (!this.zona_delivery) return 0;
                    const z = this.zonas_disponibles.find(x => x.nombre === this.zona_delivery);
                    return z ? parseFloat(z.precio) : 0;
                },

                porcentaje_envio_gratis() {
                    if (this.meta_envio_gratis === 0) return 100;
                    const p = (this.subtotal_items() / this.meta_envio_gratis) * 100;
                    return Math.min(100, p);
                },

                mensaje_envio_gratis() {
                    const sub = this.subtotal_items();
                    if (sub >= this.meta_envio_gratis) return "🎉 ¡Delivery GRATIS desbloqueado!";
                    return `¡Agrega $${(this.meta_envio_gratis - sub).toFixed(2)} más y tu delivery es GRATIS!`;
                },

                total_usd() {
                    return (this.subtotal_items() + this.costo_delivery()).toFixed(2);
                },

                total_bs() {
                    return (this.total_usd() * this.dolar_bcv).toFixed(2);
                },

                /* --- Enviar Pedido por WhatsApp --- */
                enviar_pedido() {
                    /* — Protección Honeypot anti-spam — */
                    if (isHoneypotLleno()) {
                        console.warn('Bot detectado — pedido bloqueado.');
                        return;
                    }

                    if (this.carrito.length === 0) {
                        alert('Tu canasta está vacía'); return;
                    }
                    if (!this.nombre_cliente || !this.nombre_cliente.trim()) {
                        alert('Por favor ingresa tu nombre'); return;
                    }
                    if (this.es_delivery) {
                        // Solo validar zona si hay zonas configuradas en Google Sheets
                        if (this.zonas_disponibles.length > 0 && !this.zona_delivery) {
                            alert('Por favor selecciona una zona de entrega'); return;
                        }
                        if (!this.direccion || !this.direccion.trim()) { alert('Por favor ingresa la dirección de entrega'); return; }
                    }

                    /* — Sanitizar entradas del usuario antes de construir el mensaje — */
                    const s_nombre    = sanitizeText(this.nombre_cliente);
                    const s_zona      = sanitizeText(this.zona_delivery);
                    const s_direccion = sanitizeText(this.direccion);
                    const s_referencia = sanitizeText(this.referencia);

                    let msg = `*🍞 SELLO DE CANAÁN — PEDIDO 🍯*\n`;
                    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
                    msg += `👤 *Cliente:* ${s_nombre}\n`;
                    msg += `📍 *Entrega:* ${this.es_delivery ? 'Delivery' : 'Retiro en tienda'}\n`;

                    if (this.es_delivery) {
                        msg += `🛵 *Zona:* ${s_zona}\n`;
                        msg += `🏠 *Dirección:* ${s_direccion}\n`;
                        if (s_referencia) msg += `📌 *Referencia:* ${s_referencia}\n`;
                    }

                    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
                    msg += `*📋 DETALLE DEL PEDIDO:*\n\n`;

                    this.carrito.forEach(item => {
                        let p_linea = item.precio;
                        if (item.addons_activos) {
                            p_linea += item.addons_activos.reduce((s, a) => s + (a.precio || 0), 0);
                        }

                        msg += `• ${item.cantidad}x ${sanitizeText(item.nombre)} — $${(p_linea * item.cantidad).toFixed(2)}`;

                        if (item.addons_activos && item.addons_activos.length > 0) {
                            const addons_nombres = item.addons_activos.map(a => sanitizeText(a.nombre)).join(', ');
                            msg += `\n   _+ Extras: ${addons_nombres}_`;
                        }
                        if (item.nota) msg += `\n   _📝 Nota: ${sanitizeText(item.nota)}_`;
                        msg += `\n`;
                    });

                    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                    msg += `*Subtotal Items:* $${this.subtotal_items().toFixed(2)}\n`;

                    if (this.es_delivery) {
                        const c_delivery = this.costo_delivery();
                        msg += `*Delivery:* ${c_delivery === 0 ? 'GRATIS 🎁' : '$' + c_delivery.toFixed(2)}\n`;
                    }

                    msg += `💰 *TOTAL USD:* $${this.total_usd()}\n`;
                    msg += `🇻🇪 *TOTAL Bs:* Bs. ${this.total_bs()}\n`;
                    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
                    msg += `📸 *Por favor adjunta tu capture de Pago Móvil aquí abajo* 👇\n`;
                    msg += `*Venezuela (0102) | 0412-0708031 | V-32.189.355*`;

                    // Limpiar carrito al generar la orden? No es necesario por si quieren pedir mas luego
                    window.open(`https://wa.me/${CONFIG.whatsapp_numero}?text=${encodeURIComponent(msg)}`, '_blank');
                }
            };
        }
    

        
    
