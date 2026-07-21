document.addEventListener('DOMContentLoaded', () => {
    let carrito = JSON.parse(localStorage.getItem('sanma-carrito')) || [];
    const btnCheckout = document.getElementById('btn-checkout-carrito');
    const countSpan = document.getElementById('carrito-count');
    const navCartCount = document.getElementById('nav-carrito-count');

    function actualizarContadoresCarrito() {
        const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
        
        // Actualizar botón flotante
        if (btnCheckout) {
            if (totalItems > 0) {
                btnCheckout.style.display = 'block';
                if (countSpan) countSpan.textContent = totalItems;
            } else {
                btnCheckout.style.display = 'none';
            }
        }

        // Actualizar contador del menú superior si existe
        if (navCartCount) {
            navCartCount.textContent = totalItems;
        }
    }

    // Usar delegación de eventos para agregar productos (capturando id, nombre, precio e imagen)
    document.body.addEventListener('click', (e) => {
        const boton = e.target.closest('.btn-agregar-carrito');
        if (boton) {
            const id = boton.getAttribute('data-id');
            const nombre = boton.getAttribute('data-nombre');
            const precio = parseFloat(boton.getAttribute('data-precio'));
            const imagen = boton.getAttribute('data-imagen') || '';

            const productoExistente = carrito.find(item => item.id === id);
            if (productoExistente) {
                productoExistente.cantidad += 1;
            } else {
                carrito.push({ id, nombre, precio, imagen, cantidad: 1 });
            }

            localStorage.setItem('sanma-carrito', JSON.stringify(carrito));
            actualizarContadoresCarrito();
            alert(`¡Se agregó ${nombre} a tu carrito! 🧶`);
        }
    });

    if (btnCheckout) {
        btnCheckout.addEventListener('click', () => {
            window.location.href = '/carrito'; 
        });
    }

    const cartContainer = document.getElementById('cart-items-container');
    const cartTotalElement = document.getElementById('cart-total-price');
    const inputCarritoHidden = document.getElementById('carrito_data');

    function renderizarCarritoVista() {
        if (!cartContainer) return;

        if (carrito.length > 0) {
            let html = '';
            let total = 0;
            
            carrito.forEach(item => {
                let subtotal = item.precio * item.cantidad;
                total += subtotal;
                html += `
                    <div class="cart-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 12px 0; border-bottom: 1px solid var(--border-color);">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <img src="${item.imagen}" alt="${item.nombre}" style="width: 55px; height: 55px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border-color);">
                            <div>
                                <h4 style="margin: 0 0 4px 0; font-size: 15px; color: var(--text-dark);">${item.nombre}</h4>
                                <p style="margin: 0; font-size: 13px; color: var(--text-muted);">Cantidad: ${item.cantidad} | Precio: $${item.precio.toLocaleString('es-CO')}</p>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <span style="font-weight: 700; color: var(--primary-purple);">$${subtotal.toLocaleString('es-CO')}</span>
                            <button type="button" class="btn-eliminar-item" data-id="${item.id}" style="background: #ff4d4d; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;">🗑️</button>
                        </div>
                    </div>
                `;
            });

            cartContainer.innerHTML = html;
            if (cartTotalElement) cartTotalElement.textContent = `$${total.toLocaleString('es-CO')}`;
            
            if (inputCarritoHidden) {
                inputCarritoHidden.value = JSON.stringify(carrito);
            }

            const submitBtn = document.getElementById('btn-submit-cart');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';
            }
        } else {
            cartContainer.innerHTML = `
                <div style="text-align: center; padding: 30px 0; color: var(--text-muted);">
                    <p style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Tu carrito está vacío.</p>
                    <p style="font-size: 14px;">¡Agrega tu primer producto desde el catálogo para continuar con tu pedido!</p>
                </div>
            `;
            if (cartTotalElement) cartTotalElement.textContent = '$0';
            const submitBtn = document.getElementById('btn-submit-cart');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.5';
                submitBtn.style.cursor = 'not-allowed';
            }
            if (inputCarritoHidden) {
                inputCarritoHidden.value = '';
            }
        }
    }

    // Delegación para eliminar un producto del carrito en la vista de checkout
    if (cartContainer) {
        cartContainer.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.btn-eliminar-item');
            if (deleteBtn) {
                const idToDelete = deleteBtn.getAttribute('data-id');
                carrito = carrito.filter(item => item.id !== idToDelete);
                localStorage.setItem('sanma-carrito', JSON.stringify(carrito));
                actualizarContadoresCarrito();
                renderizarCarritoVista();
            }
        });
    }

    if (document.getElementById('limpiar-carrito-exitoso')) {
        localStorage.removeItem('sanma-carrito');
        carrito = [];
    }

    actualizarContadoresCarrito();
    renderizarCarritoVista();
});