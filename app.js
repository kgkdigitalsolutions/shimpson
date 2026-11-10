/* Simpson Burguer - Versão Final Estabilizada */
(() => {
  "use strict";

  const SUPABASE_URL = "https://jmycqwnuznwculqbgavy.supabase.co";
  const SUPABASE_KEY = "sb_publishable_MO2glC7v9Y16OMbO6mZT9Q_VTHeS3Q_";
  const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const $ = (id) => document.getElementById(id);
  const money = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const image = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;

  let products = [];
  let orders = [];
  let cart = [];
  let category = "todos";
  let selectedProduct = null;
  let currentOrder = null;
  let latestPlacedOrder = null;
  let deliveryFee = 5.00;
  let adminAuthenticated = false;
  let adminFilterDate = new Date().toISOString().split('T')[0];
  let currentUser = null;

  const extras = [
    { name: "Bacon extra", price: 5 },
    { name: "Queijo extra", price: 4 },
    { name: "Ovo", price: 3 },
    { name: "Molho especial", price: 2 },
    { name: "Cheddar extra", price: 4 }
  ];

  const toast = (message) => {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2500);
  };

  const setPage = (page) => {
    ["homePage", "trackingPage", "adminPage", "myOrdersPage"].forEach(id => {
      const el = $(id);
      if (el) el.classList.toggle("hidden", id !== page);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const categoryLabel = c => ({
    burgers: "Burger",
    combos: "Combo",
    acompanhamentos: "Acompanhamento",
    bebidas: "Bebida"
  }[c] || c);

  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

  // --- Local Orders Helper (para permitir que pedidos de visitantes fiquem salvos) ---
  const getLocalOrderIds = () => {
    try {
      const stored = localStorage.getItem("sb_my_order_ids");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  };

  const saveLocalOrderId = (id) => {
    try {
      const ids = getLocalOrderIds();
      if (!ids.includes(id)) {
        ids.unshift(id);
        localStorage.setItem("sb_my_order_ids", JSON.stringify(ids));
      }
    } catch (e) {
      console.error("Erro ao salvar ID de pedido local:", e);
    }
  };

  const linkLocalOrdersToUser = async (userId) => {
    const localIds = getLocalOrderIds();
    if (!userId || !localIds.length) return;
    try {
      await supabaseClient
        .from('orders')
        .update({ user_id: userId })
        .in('id', localIds)
        .is('user_id', null);
    } catch (e) {
      console.error("Erro ao vincular pedidos locais:", e);
    }
  };

  // --- Auth Logic ---
  const checkSession = async () => {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      currentUser = session?.user || null;
    } catch (e) {
      console.error("Erro ao verificar sessão:", e);
      currentUser = null;
    }
  };

  const handleAuth = async (mode) => {
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value.trim();
    if (!email || !password) {
      toast("Preencha todos os campos!");
      return;
    }

    if (mode === 'signup') {
      const confirmPass = $("authConfirmPassword")?.value.trim();
      if (!confirmPass) {
        toast("Confirme sua senha!");
        return;
      }
      if (password !== confirmPass) {
        toast("As senhas não coincidem!");
        return;
      }
      if (password.length < 6) {
        toast("A senha deve ter pelo menos 6 caracteres.");
        return;
      }
    }

    let result;
    if (mode === 'signup') {
      result = await supabaseClient.auth.signUp({ email, password });
    } else {
      result = await supabaseClient.auth.signInWithPassword({ email, password });
    }

    if (result.error) {
      const msg = result.error.message.toLowerCase();
      let translated = result.error.message;
      if (msg.includes("invalid login credentials")) translated = "E-mail ou senha incorretos.";
      else if (msg.includes("user already registered") || msg.includes("already registered")) translated = "Este e-mail já está cadastrado. Faça login.";
      else if (msg.includes("password should be at least 6 characters")) translated = "A senha deve ter pelo menos 6 caracteres.";
      else if (msg.includes("invalid standard email") || msg.includes("valid email")) translated = "Insira um e-mail válido.";
      else if (msg.includes("rate limit")) translated = "Muitas tentativas. Aguarde alguns instantes.";

      toast(translated);
    } else {
      if (mode === 'signup') {
        // Entra automaticamente após o cadastro
        const loginRes = await supabaseClient.auth.signInWithPassword({ email, password });
        if (loginRes.data?.session) {
          currentUser = loginRes.data.user;
        } else if (result.data?.session) {
          currentUser = result.data.user;
        } else {
          currentUser = result.data?.user || null;
        }
      } else {
        currentUser = result.data.user;
      }

      if (currentUser) {
        await linkLocalOrdersToUser(currentUser.id);
        toast(mode === 'signup' ? "Conta criada! Você já está conectado." : "Bem-vindo de volta!");
      } else {
        toast("Conta criada com sucesso! Faça login para continuar.");
      }

      $("authEmail").value = "";
      $("authPassword").value = "";
      if ($("authConfirmPassword")) $("authConfirmPassword").value = "";
      await loadMyOrders();
    }
  };

  // --- Data Logic ---
  const loadProducts = async () => {
    const { data, error } = await supabaseClient.from('products').select('*').order('id', { ascending: true });
    if (!error && data) {
      products = data;
      productGrid();
    }
  };

  const loadSettings = async () => {
    const { data } = await supabaseClient.from('settings').select('value').eq('key', 'delivery_fee').single();
    if (data && data.value !== undefined) {
      deliveryFee = parseFloat(data.value) || 5.00;
    }
  };

  const loadOrders = async () => {
    const { data, error } = await supabaseClient
      .from('orders')
      .select('*')
      .gte('created_at', `${adminFilterDate}T00:00:00Z`)
      .lte('created_at', `${adminFilterDate}T23:59:59Z`)
      .order('created_at', { ascending: false });

    if (!error && data) {
      orders = data;
      if (adminAuthenticated) renderOrdersList();
    }
  };

  const DEFAULT_CATEGORY_OPTIONS = {
    burgers: [
      { name: "Bacon crocante extra", price: 5.0, section: "Adicionais do Burger", type: "checkbox", group: "burger_extras" },
      { name: "Queijo extra", price: 4.0, section: "Adicionais do Burger", type: "checkbox", group: "burger_extras" },
      { name: "Cheddar cremoso extra", price: 4.0, section: "Adicionais do Burger", type: "checkbox", group: "burger_extras" },
      { name: "Hambúrguer extra (150g)", price: 8.0, section: "Adicionais do Burger", type: "checkbox", group: "burger_extras" },
      { name: "Ovo frito na chapa", price: 3.0, section: "Adicionais do Burger", type: "checkbox", group: "burger_extras" },
      { name: "Molho especial da casa", price: 2.0, section: "Adicionais do Burger", type: "checkbox", group: "burger_extras" },
      { name: "Cebola caramelizada", price: 3.0, section: "Adicionais do Burger", type: "checkbox", group: "burger_extras" }
    ],
    bebidas: [
      { name: "Coca-Cola 350ml", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor", default: true },
      { name: "Coca-Cola Sem Açúcar 350ml", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor" },
      { name: "Guaraná Antarctica 350ml", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor" },
      { name: "Guaraná Antarctica Zero 350ml", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor" },
      { name: "Fanta Laranja 350ml", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor" },
      { name: "Sprite 350ml", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor" },
      { name: "Água Mineral com Gás", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor" },
      { name: "Água Mineral sem Gás", price: 0.0, section: "Opções de Bebida", type: "radio", group: "drink_flavor" },
      { name: "Copo descartável com gelo e limão", price: 1.0, section: "Preferências", type: "checkbox", group: "drink_extras" },
      { name: "Enviar bem gelada", price: 0.0, section: "Preferências", type: "checkbox", group: "drink_extras" },
      { name: "Sabor: Chocolate", price: 0.0, section: "Sabores de Shake", type: "radio", group: "shake_flavor" },
      { name: "Sabor: Morango", price: 0.0, section: "Sabores de Shake", type: "radio", group: "shake_flavor" },
      { name: "Sabor: Baunilha", price: 0.0, section: "Sabores de Shake", type: "radio", group: "shake_flavor" },
      { name: "Sabor: Ovomaltine", price: 2.0, section: "Sabores de Shake", type: "radio", group: "shake_flavor" },
      { name: "Sabor: Nutella", price: 4.0, section: "Sabores de Shake", type: "radio", group: "shake_flavor" },
      { name: "Chantilly extra", price: 3.0, section: "Adicionais do Shake", type: "checkbox", group: "shake_extras" },
      { name: "Calda de chocolate extra", price: 2.0, section: "Adicionais do Shake", type: "checkbox", group: "shake_extras" },
      { name: "Calda de morango extra", price: 2.0, section: "Adicionais do Shake", type: "checkbox", group: "shake_extras" }
    ],
    acompanhamentos: [
      { name: "Cheddar cremoso derretido", price: 5.0, section: "Adicionais da Porção", type: "checkbox", group: "side_extras" },
      { name: "Bacon crocante em cubos", price: 5.0, section: "Adicionais da Porção", type: "checkbox", group: "side_extras" },
      { name: "Cheddar cremoso + Bacon", price: 8.0, section: "Adicionais da Porção", type: "checkbox", group: "side_extras" },
      { name: "Pote de Molho especial da casa (50g)", price: 3.0, section: "Molhos", type: "checkbox", group: "side_extras" },
      { name: "Pote de Molho Barbecue defumado (50g)", price: 3.0, section: "Molhos", type: "checkbox", group: "side_extras" },
      { name: "Pote de Maionese de alho (50g)", price: 3.0, section: "Molhos", type: "checkbox", group: "side_extras" },
      { name: "Parmesão ralado", price: 4.0, section: "Adicionais da Porção", type: "checkbox", group: "side_extras" }
    ],
    combos: [
      { name: "Bebida: Coca-Cola Lata 350ml", price: 0.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink", default: true },
      { name: "Bebida: Coca-Cola Zero 350ml", price: 0.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Bebida: Guaraná Antarctica 350ml", price: 0.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Bebida: Guaraná Antarctica Zero 350ml", price: 0.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Bebida: Fanta Laranja 350ml", price: 0.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Bebida: Sprite 350ml", price: 0.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Bebida: Água sem Gás", price: 0.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Bebida: Trocar por Milk-shake Chocolate (+ R$ 9,00)", price: 9.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Bebida: Trocar por Milk-shake Morango (+ R$ 9,00)", price: 9.0, section: "1. Bebida do Combo", type: "radio", group: "combo_drink" },
      { name: "Batata: Cheddar cremoso", price: 5.0, section: "2. Adicionais da Batata", type: "checkbox", group: "combo_side_extras" },
      { name: "Batata: Bacon crocante em cubos", price: 5.0, section: "2. Adicionais da Batata", type: "checkbox", group: "combo_side_extras" },
      { name: "Batata: Cheddar cremoso + Bacon", price: 8.0, section: "2. Adicionais da Batata", type: "checkbox", group: "combo_side_extras" },
      { name: "Batata: Pote de molho especial (50g)", price: 3.0, section: "2. Adicionais da Batata", type: "checkbox", group: "combo_side_extras" },
      { name: "Batata: Trocar por Onion Rings", price: 4.0, section: "2. Adicionais da Batata", type: "checkbox", group: "combo_side_extras" },
      { name: "Burger: Bacon extra", price: 5.0, section: "3. Adicionais do Burger", type: "checkbox", group: "combo_burger_extras" },
      { name: "Burger: Queijo extra", price: 4.0, section: "3. Adicionais do Burger", type: "checkbox", group: "combo_burger_extras" },
      { name: "Burger: Cheddar cremoso extra", price: 4.0, section: "3. Adicionais do Burger", type: "checkbox", group: "combo_burger_extras" },
      { name: "Burger: Hambúrguer extra (150g)", price: 8.0, section: "3. Adicionais do Burger", type: "checkbox", group: "combo_burger_extras" },
      { name: "Burger: Ovo frito na chapa", price: 3.0, section: "3. Adicionais do Burger", type: "checkbox", group: "combo_burger_extras" },
      { name: "Burger: Cebola caramelizada", price: 3.0, section: "3. Adicionais do Burger", type: "checkbox", group: "combo_burger_extras" }
    ]
  };

  const parseProductMeta = (product) => {
    if (!product || !product.badge) return { badgeText: "", activeExtras: null, customExtras: null };
    try {
      if (typeof product.badge === "string" && product.badge.trim().startsWith("{")) {
        const parsed = JSON.parse(product.badge);
        return {
          badgeText: parsed.badge || "",
          activeExtras: Array.isArray(parsed.active_extras) ? parsed.active_extras : null,
          customExtras: Array.isArray(parsed.custom_extras) ? parsed.custom_extras : null
        };
      }
    } catch (e) {}
    return { badgeText: String(product.badge || ""), activeExtras: null, customExtras: null };
  };

  const getProductDisplayBadge = (product) => {
    return parseProductMeta(product).badgeText;
  };

  const groupItemsIntoSections = (items) => {
    const sectionsMap = new Map();
    items.forEach(item => {
      const secName = item.section || "ADICIONAIS";
      if (!sectionsMap.has(secName)) {
        sectionsMap.set(secName, {
          title: secName,
          subtitle: item.type === "radio" ? "Escolha 1 opção • Obrigatório" : "Opcional • Selecione quantos desejar",
          type: item.type || "checkbox",
          group: item.group || ("group_" + secName.toLowerCase().replace(/[^a-z0-9]/g, "_")),
          items: []
        });
      }
      sectionsMap.get(secName).items.push(item);
    });

    sectionsMap.forEach(sec => {
      if (sec.type === "radio" && !sec.items.some(i => i.default)) {
        if (sec.items.length > 0) sec.items[0].default = true;
      }
    });

    return Array.from(sectionsMap.values());
  };

  const productGrid = () => {
    const q = $("searchInput").value.trim().toLowerCase();
    const list = products.filter(p => (category === "todos" || p.category === category) && `${p.name} ${p.description}`.toLowerCase().includes(q));
    $("productGrid").innerHTML = list.length
      ? list.map(p => {
          const badgeText = getProductDisplayBadge(p);
          return `<article class="product-card"><div class="product-photo"><img src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity='.15'">${badgeText ? `<span class="product-badge">${escapeHtml(badgeText)}</span>` : ""}</div><div class="product-info"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description)}</p><div class="product-bottom"><span class="product-price">${money(p.price)}</span><button class="add-button" data-add="${p.id}">+ ADICIONAR</button></div></div></article>`;
        }).join("")
      : `<p class="empty-state">Não encontramos produtos com essa busca.</p>`;
  };

  const cartSubtotal = () => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  const updateCartCount = () => {
    const el = $("cartCount");
    if (el) el.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);
  };

  const openCart = () => {
    renderCart();
    $("overlay").classList.remove("hidden");
    $("cartDrawer").classList.add("open");
  };

  const closeLayers = () => {
    $("overlay").classList.add("hidden");
    $("cartDrawer").classList.remove("open");
    document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden"));
  };

  const parseExtrasList = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch {}
      }
      return trimmed.split(",").map(s => s.trim()).filter(Boolean);
    }
    return [];
  };

  const formatOrderExtrasHTML = (rawExtras) => {
    const list = parseExtrasList(rawExtras);
    if (!list.length) return "";

    return `
      <div class="order-item-extras" style="margin-top: 6px; display: flex; flex-direction: column; gap: 3px;">
        ${list.map(extra => {
          let icon = "➕";
          let label = extra;
          let categoryPrefix = "";

          if (/^bebida\s*:/i.test(extra)) {
            icon = "🥤";
            categoryPrefix = "Bebida:";
            label = extra.replace(/^bebida\s*:\s*/i, "");
          } else if (/^batata\s*:/i.test(extra)) {
            icon = "🍟";
            categoryPrefix = "Batata:";
            label = extra.replace(/^batata\s*:\s*/i, "");
          } else if (/^burger\s*:/i.test(extra)) {
            icon = "🍔";
            categoryPrefix = "Burger:";
            label = extra.replace(/^burger\s*:\s*/i, "");
          } else if (/^sabor\s*:/i.test(extra)) {
            icon = "🍨";
            categoryPrefix = "Sabor:";
            label = extra.replace(/^sabor\s*:\s*/i, "");
          } else if (/^molho\s*:/i.test(extra)) {
            icon = "🥣";
            categoryPrefix = "Molho:";
            label = extra.replace(/^molho\s*:\s*/i, "");
          } else if (/^sobremesa\s*:/i.test(extra)) {
            icon = "🍰";
            categoryPrefix = "Sobremesa:";
            label = extra.replace(/^sobremesa\s*:\s*/i, "");
          }

          return `
            <div style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #ddd; background: #222; border: 1px solid #333; padding: 3px 8px; border-radius: 4px; width: fit-content; max-width: 100%;">
              <span style="font-size: 13px;">${icon}</span>
              ${categoryPrefix ? `<b style="color: var(--yellow); font-size: 11px; text-transform: uppercase;">${categoryPrefix}</b>` : ""}
              <span style="color: #e5e5e5;">${escapeHtml(label)}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  };

  const renderCart = () => {
    $("cartItems").innerHTML = cart.length
      ? cart.map((item, i) => `
        <div class="cart-row">
          <div>
            <h4>${escapeHtml(item.name)}</h4>
            ${formatOrderExtrasHTML(item.extras)}
            <strong style="display:block; margin-top:5px;">${money(item.unitPrice * item.quantity)}</strong>
          </div>
          <div class="quantity">
            <button data-qty="${i}" data-delta="-1">−</button>
            <b>${item.quantity}</b>
            <button data-qty="${i}" data-delta="1">+</button>
          </div>
        </div>
      `).join("")
      : `<div class="empty-cart"><div style="font-size:40px">🛍</div><h3>Sua sacola está vazia.</h3><p>Escolha seu burger favorito no cardápio.</p></div>`;
    $("cartSubtotal").textContent = money(cartSubtotal());
    $("goCheckout").disabled = !cart.length;
  };

  const getProductSections = (product) => {
    const meta = parseProductMeta(product);
    let items = null;

    if (meta.activeExtras && Array.isArray(meta.activeExtras)) {
      items = meta.activeExtras.filter(item => item.active !== false);
    } else {
      const cat = product.category || "burgers";
      const nameLower = (product.name || "").toLowerCase();
      const descLower = (product.description || "").toLowerCase();
      const fullText = `${nameLower} ${descLower}`;

      if (cat === "bebidas") {
        const isShake = /shake|milk/i.test(fullText);
        const allDrinkOptions = DEFAULT_CATEGORY_OPTIONS.bebidas || [];
        if (isShake) {
          items = allDrinkOptions.filter(o => o.group === "shake_flavor" || o.group === "shake_extras");
        } else {
          items = allDrinkOptions.filter(o => o.group === "drink_flavor" || o.group === "drink_extras");
        }
      } else {
        items = DEFAULT_CATEGORY_OPTIONS[cat] || DEFAULT_CATEGORY_OPTIONS.burgers;
      }
    }

    if (!items || items.length === 0) {
      return [];
    }

    return groupItemsIntoSections(items);
  };

  const showProduct = id => {
    selectedProduct = products.find(p => p.id === Number(id));
    if (!selectedProduct) return;

    const sections = getProductSections(selectedProduct);

    const sectionsHtml = sections.length ? sections.map(section => `
      <div class="option-section">
        <div class="option-section-title">
          <b>${escapeHtml(section.title)}</b>
          <small>${escapeHtml(section.subtitle)}</small>
        </div>
        <div>
          ${section.items.map(item => `
            <label class="extra-option">
              <span>
                ${escapeHtml(item.name)}
                ${item.price > 0 ? `<small style="color:var(--yellow); font-weight:700;">+ ${money(item.price)}</small>` : ""}
              </span>
              <input
                type="${section.type}"
                name="${section.group}"
                data-name="${escapeHtml(item.name)}"
                data-price="${item.price}"
                ${item.default ? "checked" : ""}
              >
            </label>
          `).join("")}
        </div>
      </div>
    `).join("") : `<p style="color:#aaa; font-size:14px; margin:15px 0;">Este item não possui adicionais.</p>`;

    $("productModalContent").innerHTML = `
      <div class="modal-product-image">
        <img src="${selectedProduct.image}" alt="${escapeHtml(selectedProduct.name)}">
      </div>
      <span class="eyebrow">${categoryLabel(selectedProduct.category).toUpperCase()}</span>
      <h2>${escapeHtml(selectedProduct.name)}</h2>
      <p>${escapeHtml(selectedProduct.ingredients || selectedProduct.description)}</p>
      <h3 style="color:var(--yellow)">${money(selectedProduct.price)}</h3>
      <div style="margin-top: 15px;">
        ${sectionsHtml}
      </div>
      <button class="button button-primary full" id="addSelected" style="margin-top: 20px; font-size: 15px;">
        ADICIONAR À SACOLA · <span id="modalCurrentTotal">${money(selectedProduct.price)}</span>
      </button>`;

    const updateModalTotal = () => {
      const selectedInputs = $("productModalContent").querySelectorAll("input:checked");
      let extrasTotal = 0;
      selectedInputs.forEach(input => {
        extrasTotal += parseFloat(input.dataset.price) || 0;
      });
      const currentTotal = selectedProduct.price + extrasTotal;
      const totalEl = $("modalCurrentTotal");
      if (totalEl) totalEl.textContent = money(currentTotal);
    };

    $("productModalContent").onchange = updateModalTotal;
    updateModalTotal();

    $("productModal").classList.remove("hidden");

    $("addSelected").onclick = () => {
      const selectedInputs = [...$("productModalContent").querySelectorAll("input:checked")];
      const chosenExtras = selectedInputs.map(input => ({
        name: input.dataset.name,
        price: parseFloat(input.dataset.price) || 0
      }));
      const extrasTotal = chosenExtras.reduce((sum, e) => sum + e.price, 0);
      const unitPrice = selectedProduct.price + extrasTotal;
      const extrasNames = chosenExtras.map(e => e.name);
      const key = selectedProduct.id + "-" + extrasNames.slice().sort().join("|");
      const existing = cart.find(i => i.key === key);
      if (existing) {
        existing.quantity++;
      } else {
        cart.push({
          key,
          id: selectedProduct.id,
          name: selectedProduct.name,
          unitPrice,
          quantity: 1,
          extras: extrasNames
        });
      }
      updateCartCount();
      closeLayers();
      openCart();
    };
  };

  const updateCheckoutTotals = () => {
    const fee = $("fulfillment").value === "delivery" ? deliveryFee : 0;
    $("checkoutSubtotal").textContent = money(cartSubtotal());
    $("checkoutFee").textContent = money(fee);
    $("checkoutTotal").textContent = money(cartSubtotal() + fee);
    $("addressSection").classList.toggle("hidden", $("fulfillment").value !== "delivery");
  };

  const showTracking = async order => {
    currentOrder = order;
    setPage("trackingPage");
    const steps = ["Pedido recebido", "Pagamento aprovado", "Preparando pedido", "Saiu para entrega", "Pedido entregue"];
    $("trackingResult").innerHTML = `
      <div class="tracking-card">
        <span class="eyebrow">PEDIDO #${order.id}</span>
        <h2 style="font:600 28px var(--display);margin:8px 0">${steps[order.status] || steps[0]}</h2>
        <p style="color:#999;font-size:13px">Olá, <b>${escapeHtml(order.customer_name)}</b>. Acompanhe as etapas abaixo.</p>
        ${steps.map((s, i) => `<div class="tracking-step ${i <= order.status ? "done" : ""}"> <span class="step-circle">${i <= order.status ? "✓" : i + 1}</span><span><b>${s}</b><small>${i === order.status ? "Etapa atual" : i < order.status ? "Concluído" : "Aguardando"}</small></span></div>`).join("")}
        <hr style="border:0;border-top:1px solid #333;margin:20px 0">
        
        <h3 style="font:600 18px var(--display); margin-bottom: 12px; color: #fff;">ITENS DO PEDIDO</h3>
        <div id="trackingItemsList" style="background:#1b1b1b; padding:12px; border-radius:6px; border-left:3px solid var(--yellow); margin-bottom:15px;">
          Carregando itens...
        </div>

        <p style="font-size:14px;">Recebimento: <b>${order.fulfillment === "pickup" ? "Retirada no balcão" : "Entrega em casa"}</b></p>
        ${order.address ? `<p style="font-size:13px; color:#aaa;">Endereço: <b>${escapeHtml(order.address)}</b></p>` : ""}
        <p style="font-size:16px;">Total: <b style="color:var(--yellow); font-size:20px;">${money(order.total)}</b></p>
      </div>`;

    const { data: items } = await supabaseClient.from('order_items').select('*').eq('order_id', order.id);
    const container = $("trackingItemsList");
    if (container) {
      if (items && items.length) {
        container.innerHTML = items.map(i => `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; border-bottom:1px solid #282828; padding-bottom:6px;">
            <div style="flex:1;">
              <span style="font-size:14px; font-weight:700; color:#fff;">
                <b style="color:var(--yellow);">${i.quantity}x</b> ${escapeHtml(i.name)}
              </span>
              ${formatOrderExtrasHTML(i.extras)}
            </div>
            <span style="font-weight:700; font-size:14px; color:#fff; margin-left:12px;">${money(i.unit_price * i.quantity)}</span>
          </div>
        `).join("");
      } else {
        container.innerHTML = `<span style="color:#888; font-size:13px;">Itens não encontrados</span>`;
      }
    }
  };

  // --- Meus Pedidos ---
  const loadMyOrders = async () => {
    await checkSession();
    const list = $("myOrdersList");
    const empty = $("myOrdersEmpty");
    const authBox = $("myOrdersAuth");
    const userBar = $("myOrdersUserBar");
    const guestPrompt = $("myOrdersGuestPrompt");

    if (list) {
      list.innerHTML = `<p style="text-align:center; color:#888; padding: 20px;">Carregando pedidos...</p>`;
      list.classList.remove("hidden");
    }
    if (empty) empty.classList.add("hidden");

    const localIds = getLocalOrderIds();
    let ordersData = [];

    if (currentUser) {
      if (userBar) {
        userBar.classList.remove("hidden");
        $("myOrdersUserEmail").textContent = currentUser.email || "";
      }
      if (guestPrompt) guestPrompt.classList.add("hidden");
      if (authBox) authBox.classList.add("hidden");

      if (localIds.length > 0) {
        await linkLocalOrdersToUser(currentUser.id);
      }

      const { data, error } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) {
        toast("Erro ao carregar pedidos.");
        if (list) list.innerHTML = `<p class="form-error" style="text-align:center; padding: 20px;">Erro ao carregar pedidos.</p>`;
        return;
      }
      ordersData = data || [];
    } else {
      if (userBar) userBar.classList.add("hidden");

      if (localIds.length > 0) {
        const { data, error } = await supabaseClient
          .from('orders')
          .select('*')
          .in('id', localIds)
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          ordersData = data;
          if (guestPrompt) guestPrompt.classList.remove("hidden");
          if (authBox) authBox.classList.add("hidden");
        } else {
          ordersData = [];
          if (guestPrompt) guestPrompt.classList.add("hidden");
          if (authBox) authBox.classList.remove("hidden");
        }
      } else {
        ordersData = [];
        if (guestPrompt) guestPrompt.classList.add("hidden");
        if (authBox) authBox.classList.remove("hidden");
      }
    }

    if (!ordersData.length) {
      if (list) list.classList.add("hidden");
      if (empty && currentUser) empty.classList.remove("hidden");
      return;
    }

    if (empty) empty.classList.add("hidden");
    if (list) list.classList.remove("hidden");

    const steps = ["Pedido recebido", "Pagamento aprovado", "Preparando pedido", "Saiu para entrega", "Pedido entregue"];
    const statusColors = ["#f5c928", "#4ade80", "#60a5fa", "#f97316", "#22c55e"];

    const cardsHtml = await Promise.all(ordersData.map(async o => {
      const { data: items } = await supabaseClient
        .from('order_items')
        .select('*')
        .eq('order_id', o.id);

      const itemsHTML = items && items.length
        ? items.map(i => `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; font-size:14px; color:#ccc; margin-bottom:8px; border-bottom:1px solid #282828; padding-bottom:6px;">
              <div style="flex:1;">
                <span style="font-weight:700; color:#fff;">
                  <b style="color:var(--yellow);">${i.quantity}x</b> ${escapeHtml(i.name)}
                </span>
                ${formatOrderExtrasHTML(i.extras)}
              </div>
              <span style="font-weight:700; color:#fff; margin-left:12px; font-size:14px;">${money(i.unit_price * i.quantity)}</span>
            </div>`).join("")
        : `<p style="color:#777; font-size:12px;">Sem itens detalhados</p>`;

      const statusIndex = typeof o.status === "number" ? o.status : 0;
      const statusText = steps[statusIndex] || "Em andamento";
      const statusColor = statusColors[statusIndex] || "var(--yellow)";

      return `
        <article class="admin-order" style="border: 1px solid #333; padding: 18px; border-radius: 10px; background: #161616;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 10px;">
            <div>
              <span style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: var(--yellow);">PEDIDO #${o.id}</span>
              <h3 style="font: 600 20px var(--display); margin: 4px 0 0; color: #fff;">${escapeHtml(o.customer_name || "Cliente")}</h3>
              <small style="color: #888; font-size: 12px;">${new Date(o.created_at).toLocaleString("pt-BR")} · ${o.fulfillment === "pickup" ? "Retirada no balcão" : "Entrega em casa"}</small>
            </div>
            <div style="text-align: right;">
              <span style="display: block; font: 700 22px var(--display); color: var(--yellow);">${money(o.total)}</span>
              <span style="display: inline-block; margin-top: 4px; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: #222; color: ${statusColor}; border: 1px solid ${statusColor}44;">
                ● ${statusText}
              </span>
            </div>
          </div>

          <div style="background: #1e1e1e; padding: 12px; border-radius: 6px; margin: 12px 0; border-left: 3px solid var(--yellow);">
            ${itemsHTML}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #262626;">
            <div style="font-size: 12px; color: #999;">
              ${o.delivery_code ? `Código de entrega: <b style="color:var(--yellow); letter-spacing:2px;">${o.delivery_code}</b>` : `Forma: <b>${o.fulfillment === "pickup" ? "Retirada" : "Delivery"}</b>`}
            </div>
            <button class="button button-outline" style="min-height:36px; padding:8px 16px; font-size:11px;" data-track-my-order="${o.id}">
              ACOMPANHAR ⌁
            </button>
          </div>
        </article>`;
    }));

    list.innerHTML = cardsHtml.join("");

    list.querySelectorAll("[data-track-my-order]").forEach(btn => {
      btn.onclick = () => {
        const orderId = Number(btn.dataset.trackMyOrder);
        const order = ordersData.find(x => x.id === orderId);
        if (order) showTracking(order);
      };
    });
  };

  const renderOrdersList = async () => {
    const container = $("ordersContainer");
    if (!container) return;
    container.innerHTML = orders.length
      ? orders.map(o => `
          <article class="admin-order">
            <div class="admin-order-head">
              <div>
                <b style="font-size: 18px;">Pedido #${o.id} · ${escapeHtml(o.customer_name)}</b>
                <p style="font-size: 14px;">${new Date(o.created_at).toLocaleString("pt-BR")} · ${o.fulfillment === "pickup" ? "Retirada" : "Delivery"} · ${escapeHtml(o.payment.toUpperCase())}</p>
              </div>
              <b style="color:var(--yellow); font-size: 20px;">${money(o.total)}</b>
            </div>
            <div id="items-${o.id}" style="background: #1a1a1a; padding: 12px; border-radius: 6px; margin: 10px 0; border-left: 4px solid var(--yellow); font-size: 15px; line-height: 1.6;">Carregando itens...</div>
            <p style="font-size: 15px;">📞 ${escapeHtml(o.customer_phone)} · 📍 ${escapeHtml(o.address || "Retirada no balcão")}</p>
            <label style="font-size:13px;color:#999; font-weight: 600;">STATUS DO PEDIDO<br>
              <select data-order-status="${o.id}" style="font-size: 16px; padding: 5px; margin-top: 5px;">
                ${["Pedido recebido", "Pagamento aprovado", "Preparando pedido", "Saiu para entrega", "Pedido entregue"].map((st, i) => `<option value="${i}" ${i === o.status ? "selected" : ""}>${st}</option>`).join("")}
              </select>
            </label>
          </article>`).join("")
      : `<p class="muted">Nenhum pedido encontrado para esta data.</p>`;

    for (const o of orders) {
      const { data: items } = await supabaseClient.from('order_items').select('*').eq('order_id', o.id);
      const itemsHTML = items && items.length
        ? items.map(i => `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; border-bottom: 1px solid #2d2d2d; padding-bottom: 6px;">
              <div style="flex: 1;">
                <div style="font-size: 15px; font-weight: 700; color: #fff;">
                  <span style="color: var(--yellow);">${i.quantity}x</span> ${escapeHtml(i.name)}
                </div>
                ${formatOrderExtrasHTML(i.extras)}
              </div>
              <span style="font-weight: 700; font-size: 14px; color: var(--yellow); margin-left: 12px;">
                ${money(i.unit_price * i.quantity)}
              </span>
            </div>
          `).join("")
        : "Sem itens";
      const el = $(`items-${o.id}`);
      if (el) el.innerHTML = itemsHTML;
    }
    setupOrderEvents();
  };

  const setupOrderEvents = () => {
    $("adminOrders").querySelectorAll("[data-order-status]").forEach(sel => sel.onchange = async () => {
      const orderId = sel.dataset.orderStatus;
      const newStatus = Number(sel.value);
      const { error } = await supabaseClient.from('orders').update({ status: newStatus }).eq('id', orderId);
      if (error) toast("Erro ao atualizar status."); else toast("Status atualizado!");
    });
  };

  const refreshAdminStats = async () => {
    $("adminStats").innerHTML = [
      ["Pedidos", orders.length],
      ["Vendas", money(orders.reduce((s, o) => s + Number(o.total), 0))],
      ["Produtos", products.length],
      ["Taxa", money(deliveryFee)]
    ].map(([label, value]) => `<div class="stat-card"><small style="font-size: 14px;">${label}</small><b style="font-size: 22px;">${value}</b></div>`).join("");
  };

  const renderAdminProducts = () => {
    $("adminProducts").innerHTML = `
      <form class="admin-form" id="productForm">
        <h3 id="productFormTitle" style="font:600 24px var(--display)">CADASTRAR PRODUTO</h3>
        <input type="hidden" name="id">
        <div class="admin-form-grid">
          <label>Nome<input name="name" required style="font-size: 16px;"></label>
          <label>Preço (R$)<input name="price" type="number" min=".01" step=".01" required style="font-size: 16px;"></label>
          <label>Categoria<select name="category" id="productCategorySelect" style="font-size: 16px;">
            <option value="burgers">Burger</option>
            <option value="combos">Combo</option>
            <option value="acompanhamentos">Acompanhamento</option>
            <option value="bebidas">Bebida</option>
          </select></label>
          <label>URL da foto<input name="image" type="url" placeholder="https://..." style="font-size: 16px;"></label>
        </div>
        <label>Descrição<input name="description" required style="font-size: 16px;"></label>
        <label>Ingredientes<input name="ingredients" style="font-size: 16px;"></label>
        <label>Badge / Destaque (opcional)<input name="badgeText" placeholder="Ex: MAIS PEDIDO, NOVO, COMBO" style="font-size: 16px;"></label>

        <!-- Configuração de Componentes e Adicionais do Produto -->
        <div class="product-extras-editor" style="margin: 22px 0; padding: 20px; background: #181818; border: 1px solid #333; border-radius: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
            <div>
              <b style="font-size: 17px; color: var(--yellow); letter-spacing:0.5px;">OPÇÕES, ITENS E ADICIONAIS DO PRODUTO</b>
              <small style="display:block; color:#aaa; font-size:13px; margin-top:3px; line-height:1.4;">
                Personalize os itens e adicionais deste produto. Remova seções inteiras (ex: retirar a batata ou o refri de um combo), exclua opções que não serve, desmarque opções temporariamente fora de estoque ou adicione novos itens.
              </small>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" id="btnSelectAllExtras" class="button button-outline" style="min-height:32px; padding:4px 10px; font-size:11px;">Marcar todos</button>
              <button type="button" id="btnDeselectAllExtras" class="button button-outline" style="min-height:32px; padding:4px 10px; font-size:11px;">Desmarcar todos</button>
              <button type="button" id="btnResetDefaultExtras" class="button button-outline" style="min-height:32px; padding:4px 10px; font-size:11px; border-color:#8e7a35; color:var(--yellow);" title="Recarregar modelo padrão desta categoria">Restaurar padrões</button>
            </div>
          </div>

          <!-- Lista de Seções e Opções -->
          <div id="productExtrasChecklist" style="display:grid; gap:12px; max-height:480px; overflow-y:auto; padding-right:5px;"></div>
          
          <!-- Formulário para Adicionar Opção / Nova Seção de Item -->
          <div style="margin-top:18px; padding-top:16px; border-top:1px dashed #3a3a3a; background:#1e1e1e; padding:15px; border-radius:6px;">
            <b style="display:block; color:var(--yellow); font-size:13px; margin-bottom:10px; text-transform:uppercase; letter-spacing:0.5px;">
              + Adicionar Item ou Adicional a este Produto
            </b>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; align-items:end;">
              <div>
                <label style="font-size:12px; color:#bbb; display:block; margin-bottom:4px;">Seção / Item:</label>
                <select id="extraTargetSection" style="width:100%; font-size:13px; padding:8px 10px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; margin:0;"></select>
              </div>
              <div id="newSectionNameWrapper" class="hidden">
                <label style="font-size:12px; color:#bbb; display:block; margin-bottom:4px;">Nome da Nova Seção:</label>
                <input type="text" id="newSectionNameInput" placeholder="Ex: Sobremesa do Combo, Molhos" style="width:100%; font-size:13px; padding:8px 10px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; margin:0;">
              </div>
              <div>
                <label style="font-size:12px; color:#bbb; display:block; margin-bottom:4px;">Tipo da Opção:</label>
                <select id="newOptionTypeSelect" style="width:100%; font-size:13px; padding:8px 10px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; margin:0;">
                  <option value="checkbox">Opcional (Checkbox - múltiplos)</option>
                  <option value="radio">Escolha Única (Radio - obrigatório 1)</option>
                </select>
              </div>
              <div>
                <label style="font-size:12px; color:#bbb; display:block; margin-bottom:4px;">Nome da Opção:</label>
                <input type="text" id="newOptionNameInput" placeholder="Ex: Batata Rústica, Suco de Laranja" style="width:100%; font-size:13px; padding:8px 10px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; margin:0;">
              </div>
              <div>
                <label style="font-size:12px; color:#bbb; display:block; margin-bottom:4px;">Preço adicional (R$):</label>
                <input type="number" id="newOptionPriceInput" placeholder="0.00" step="0.50" min="0" value="0.00" style="width:100%; font-size:13px; padding:8px 10px; background:#111; color:#fff; border:1px solid #444; border-radius:4px; margin:0;">
              </div>
              <div>
                <button type="button" id="btnAddOptionToProduct" class="button button-primary" style="width:100%; min-height:38px; padding:8px 14px; font-size:12px;">
                  INCLUIR OPÇÃO
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="admin-form-actions">
          <button class="button button-primary" id="productSubmit" style="font-size: 18px;">SALVAR PRODUTO</button>
          <button class="button button-outline hidden" type="button" id="cancelProductEdit" style="font-size: 18px;">CANCELAR</button>
        </div>
      </form>
      <h3 class="admin-subtitle" style="font-size: 22px;">PRODUTOS DO CARDÁPIO</h3>
      ${products.map(p => {
        const meta = parseProductMeta(p);
        const activeCount = meta.activeExtras
          ? meta.activeExtras.filter(i => i.active !== false).length
          : (DEFAULT_CATEGORY_OPTIONS[p.category] || []).length;
        const totalCount = meta.activeExtras ? meta.activeExtras.length : activeCount;
        return `
        <div class="admin-product-row" style="font-size: 16px;">
          <span>
            <b style="font-size: 18px;">${escapeHtml(p.name)}</b>
            <small style="display:block;color:#999;margin-top:5px; font-size: 14px;">
              ${categoryLabel(p.category)} · ${money(p.price)}
              ${meta.badgeText ? ` · <span style="color:var(--yellow); font-weight:700;">[${escapeHtml(meta.badgeText)}]</span>` : ""}
              · <span style="color:#aaa;">${activeCount} ativas de ${totalCount} opções</span>
            </small>
          </span>
          <div class="product-row-actions">
            <button data-edit-product="${p.id}">EDITAR</button>
            <button data-delete-product="${p.id}">EXCLUIR</button>
          </div>
        </div>`;
      }).join("")}
    `;
    setupProductFormEvents();
  };

  const setupProductFormEvents = () => {
    const form = $("productForm");
    if (!form) return;

    let currentEditingExtras = [];

    const getCandidateOptionsForCategory = (cat, prodName = "") => {
      const allDefaults = DEFAULT_CATEGORY_OPTIONS[cat] || DEFAULT_CATEGORY_OPTIONS.burgers || [];
      const isShake = /shake|milk/i.test(prodName);

      return allDefaults.map(opt => {
        let active = true;
        if (cat === "bebidas") {
          const isOptShake = opt.group === "shake_flavor" || opt.group === "shake_extras";
          if (isShake && !isOptShake) active = false;
          if (!isShake && isOptShake) active = false;
        }
        return { ...opt, active };
      });
    };

    const updateTargetSectionDropdown = () => {
      const select = $("extraTargetSection");
      if (!select) return;

      const currentVal = select.value;
      const sections = [...new Set(currentEditingExtras.map(i => i.section).filter(Boolean))];

      let optionsHtml = "";
      sections.forEach(sec => {
        optionsHtml += `<option value="${escapeHtml(sec)}">${escapeHtml(sec)}</option>`;
      });
      optionsHtml += `<option value="__NEW_SECTION__">➕ Criar Nova Seção / Categoria de Item...</option>`;

      select.innerHTML = optionsHtml;
      if (sections.includes(currentVal)) {
        select.value = currentVal;
      }
      handleSectionSelectChange();
    };

    const handleSectionSelectChange = () => {
      const select = $("extraTargetSection");
      const wrapper = $("newSectionNameWrapper");
      if (!select || !wrapper) return;

      if (select.value === "__NEW_SECTION__") {
        wrapper.classList.remove("hidden");
        const inp = $("newSectionNameInput");
        if (inp) inp.focus();
      } else {
        wrapper.classList.add("hidden");
      }
    };

    const targetSectionSelect = $("extraTargetSection");
    if (targetSectionSelect) {
      targetSectionSelect.onchange = handleSectionSelectChange;
    }

    const renderExtrasChecklist = () => {
      const container = $("productExtrasChecklist");
      if (!container) return;

      if (!currentEditingExtras.length) {
        container.innerHTML = `<div style="color:#aaa; font-size:13px; padding:15px; text-align:center; background:#222; border-radius:6px;">Nenhum adicional ou componente cadastrado para este produto.<br><small style="color:#777;">Adicione seções no painel abaixo ou clique em 'Restaurar padrões'.</small></div>`;
        updateTargetSectionDropdown();
        return;
      }

      const sectionsMap = new Map();
      currentEditingExtras.forEach((item, index) => {
        const sec = item.section || "Geral";
        if (!sectionsMap.has(sec)) sectionsMap.set(sec, []);
        sectionsMap.get(sec).push({ item, index });
      });

      let html = "";
      sectionsMap.forEach((entryList, secTitle) => {
        const secType = entryList[0]?.item.type || "checkbox";
        const typeBadge = secType === "radio"
          ? `<span style="font-size:10px; background:#382d11; color:var(--yellow); padding:2px 6px; border-radius:3px; border:1px solid #5a4616; font-weight:700;">Escolha 1 (Radio)</span>`
          : `<span style="font-size:10px; background:#222; color:#aaa; padding:2px 6px; border-radius:3px; border:1px solid #333; font-weight:700;">Opcional (Checkbox)</span>`;

        html += `
          <div style="background:#202020; border:1px solid #333; border-radius:6px; padding:12px; margin-bottom:4px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px; border-bottom:1px solid #2a2a2a; padding-bottom:8px;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <b style="font-size:13px; color:var(--yellow); text-transform:uppercase; letter-spacing:0.5px;">${escapeHtml(secTitle)}</b>
                ${typeBadge}
                <small style="color:#888; font-size:11px;">(${entryList.length} opções)</small>
              </div>
              <button type="button" data-remove-section="${escapeHtml(secTitle)}" style="background:none; border:1px solid #632a24; color:#ff9080; padding:4px 10px; font-size:11px; font-weight:700; border-radius:4px; cursor:pointer;" title="Remover esta seção inteira e todas as suas opções">
                🗑 Remover Seção
              </button>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:6px;">
              ${entryList.map(({ item, index }) => `
                <div style="display:flex; align-items:center; gap:8px; font-size:13px; background:#171717; padding:8px 10px; border-radius:4px; border:1px solid ${item.active ? '#554415' : '#2b2b2b'};">
                  <input type="checkbox" data-extra-index="${index}" ${item.active ? "checked" : ""} style="width:16px; height:16px; accent-color:var(--yellow); margin:0; cursor:pointer;" title="Marcar/Desmarcar disponibilidade">
                  <span style="flex:1; cursor:pointer; color:${item.active ? '#eee' : '#777'}; text-decoration:${item.active ? 'none' : 'line-through'};" data-toggle-index="${index}">
                    ${escapeHtml(item.name)}
                    ${item.price > 0 ? `<b style="color:var(--yellow); margin-left:4px;">+ ${money(item.price)}</b>` : ""}
                  </span>
                  <button type="button" data-remove-item="${index}" style="background:none; border:0; color:#ff6b5b; font-size:16px; line-height:1; font-weight:bold; cursor:pointer; padding:0 6px;" title="Excluir este adicional do produto">×</button>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      });

      container.innerHTML = html;

      // Checkbox changes
      container.querySelectorAll("input[data-extra-index]").forEach(chk => {
        chk.onchange = (e) => {
          const idx = Number(e.target.dataset.extraIndex);
          if (currentEditingExtras[idx]) {
            currentEditingExtras[idx].active = e.target.checked;
            renderExtrasChecklist();
          }
        };
      });

      // Text clicks toggle checkbox
      container.querySelectorAll("[data-toggle-index]").forEach(span => {
        span.onclick = () => {
          const idx = Number(span.dataset.toggleIndex);
          if (currentEditingExtras[idx]) {
            currentEditingExtras[idx].active = !currentEditingExtras[idx].active;
            renderExtrasChecklist();
          }
        };
      });

      // Remove single item (standard or custom)
      container.querySelectorAll("[data-remove-item]").forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          const idx = Number(btn.dataset.removeItem);
          const item = currentEditingExtras[idx];
          if (item) {
            currentEditingExtras.splice(idx, 1);
            renderExtrasChecklist();
            toast(`Opção "${item.name}" excluída.`);
          }
        };
      });

      // Remove entire section
      container.querySelectorAll("[data-remove-section]").forEach(btn => {
        btn.onclick = (e) => {
          e.preventDefault();
          const secName = btn.dataset.removeSection;
          if (confirm(`Remover toda a seção "${secName}" deste produto?`)) {
            currentEditingExtras = currentEditingExtras.filter(i => i.section !== secName);
            renderExtrasChecklist();
            toast(`Seção "${secName}" removida.`);
          }
        };
      });

      updateTargetSectionDropdown();
    };

    const loadCategoryOptions = (cat, prodName = "", existingActive = null) => {
      if (existingActive && Array.isArray(existingActive)) {
        currentEditingExtras = existingActive.map(item => ({
          ...item,
          active: item.active !== false
        }));
      } else {
        currentEditingExtras = getCandidateOptionsForCategory(cat, prodName);
      }
      renderExtrasChecklist();
    };

    // Inicializa adicionais para a categoria atual do formulário
    loadCategoryOptions(form.elements.category.value, form.elements.name.value);

    // Quando o admin altera a categoria no select
    form.elements.category.onchange = () => {
      loadCategoryOptions(form.elements.category.value, form.elements.name.value);
    };

    // Marcar todos
    const selectAllBtn = $("btnSelectAllExtras");
    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        currentEditingExtras.forEach(i => i.active = true);
        renderExtrasChecklist();
      };
    }

    // Desmarcar todos
    const deselectAllBtn = $("btnDeselectAllExtras");
    if (deselectAllBtn) {
      deselectAllBtn.onclick = () => {
        currentEditingExtras.forEach(i => i.active = false);
        renderExtrasChecklist();
      };
    }

    // Restaurar padrões
    const resetBtn = $("btnResetDefaultExtras");
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (confirm("Restaurar todas as opções e adicionais padrão desta categoria?")) {
          currentEditingExtras = getCandidateOptionsForCategory(form.elements.category.value, form.elements.name.value);
          renderExtrasChecklist();
          toast("Padrões da categoria restaurados!");
        }
      };
    }

    // Incluir nova opção / seção
    const addOptionBtn = $("btnAddOptionToProduct");
    if (addOptionBtn) {
      addOptionBtn.onclick = () => {
        const targetSelect = $("extraTargetSection");
        const nameInput = $("newOptionNameInput");
        const priceInput = $("newOptionPriceInput");
        const typeSelect = $("newOptionTypeSelect");
        const newSecInput = $("newSectionNameInput");

        const name = nameInput.value.trim();
        const price = parseFloat(priceInput.value) || 0;
        const type = typeSelect.value || "checkbox";

        let sectionName = targetSelect ? targetSelect.value : "";
        if (sectionName === "__NEW_SECTION__" || !sectionName) {
          sectionName = newSecInput ? newSecInput.value.trim() : "";
          if (!sectionName) {
            toast("Digite o nome da nova seção.");
            return;
          }
        }

        if (!name) {
          toast("Informe o nome da opção/adicional.");
          return;
        }

        const group = "group_" + sectionName.toLowerCase().replace(/[^a-z0-9]/g, "_");

        currentEditingExtras.push({
          name,
          price,
          section: sectionName,
          type,
          group,
          active: true,
          custom: true
        });

        nameInput.value = "";
        priceInput.value = "0.00";
        if (newSecInput) newSecInput.value = "";

        renderExtrasChecklist();
        toast(`Opção adicionada em "${sectionName}"!`);
      };
    }

    // Cancelar edição
    $("cancelProductEdit").onclick = () => {
      form.reset();
      form.elements.id.value = "";
      if (form.elements.badgeText) form.elements.badgeText.value = "";
      $("productFormTitle").textContent = "CADASTRAR PRODUTO";
      $("productSubmit").textContent = "SALVAR PRODUTO";
      $("cancelProductEdit").classList.add("hidden");
      loadCategoryOptions(form.elements.category.value);
    };

    // Submissão do formulário
    form.onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(form);
      const id = f.get("id");

      const activeExtras = currentEditingExtras.map(({ name, price, section, type, group, default: def, active }) => ({
        name: name.trim(),
        price: Number(price) || 0,
        section: section || "Adicionais",
        type: type || "checkbox",
        group: group || ("group_" + (section || "extra").toLowerCase().replace(/[^a-z0-9]/g, "_")),
        active: active !== false,
        ...(def ? { default: true } : {})
      }));

      const badgePayload = JSON.stringify({
        badge: f.get("badgeText")?.trim() || "",
        active_extras: activeExtras
      });

      const data = {
        name: f.get("name").trim(),
        price: parseFloat(f.get("price")),
        category: f.get("category"),
        description: f.get("description").trim(),
        ingredients: f.get("ingredients")?.trim() || "",
        image: f.get("image")?.trim() || image("photo-1568901346375-23c9450c58cd"),
        badge: badgePayload
      };

      if (id) await supabaseClient.from('products').update(data).eq('id', id);
      else await supabaseClient.from('products').insert([data]);

      await loadProducts();
      refreshAdminStats();
      renderAdminProducts();
      productGrid();
      toast(id ? "Produto e opções atualizados com sucesso!" : "Produto cadastrado com sucesso!");
    };

    // Click em Editar
    $("adminProducts").querySelectorAll("[data-edit-product]").forEach(btn => btn.onclick = () => {
      const p = products.find(x => x.id === Number(btn.dataset.editProduct));
      if (!p) return;
      form.elements.id.value = p.id;
      form.elements.name.value = p.name;
      form.elements.price.value = p.price;
      form.elements.category.value = p.category;
      form.elements.image.value = p.image || "";
      form.elements.description.value = p.description || "";
      form.elements.ingredients.value = p.ingredients || "";

      const meta = parseProductMeta(p);
      if (form.elements.badgeText) {
        form.elements.badgeText.value = meta.badgeText || "";
      }

      $("productFormTitle").textContent = "EDITAR PRODUTO";
      $("productSubmit").textContent = "SALVAR ALTERAÇÕES";
      $("cancelProductEdit").classList.remove("hidden");

      loadCategoryOptions(p.category, p.name, meta.activeExtras);

      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    // Click em Excluir
    $("adminProducts").querySelectorAll("[data-delete-product]").forEach(btn => btn.onclick = async () => {
      if (confirm("Excluir produto?")) {
        await supabaseClient.from('products').delete().eq('id', Number(btn.dataset.deleteProduct));
        await loadProducts();
        refreshAdminStats();
        renderAdminProducts();
        productGrid();
        toast("Produto excluído!");
      }
    });
  };

  const renderDeliverySettings = () => {
    const el = $("adminDelivery");
    if (!el) return;
    el.innerHTML = `
      <form class="admin-form" id="deliveryForm">
        <h3 style="font:600 24px var(--display)">CONFIGURAÇÕES DE ENTREGA</h3>
        <label>Taxa de entrega padrão (R$)
          <input name="fee" id="deliveryFeeInput" type="number" step="0.50" min="0" value="${deliveryFee}" required style="font-size: 16px;">
        </label>
        <button class="button button-primary" style="margin-top: 15px; font-size: 16px;">SALVAR TAXA</button>
      </form>
    `;
    $("deliveryForm").onsubmit = async (e) => {
      e.preventDefault();
      const val = parseFloat($("deliveryFeeInput").value) || 0;
      deliveryFee = val;
      const { error } = await supabaseClient.from('settings').upsert({ key: 'delivery_fee', value: String(val) }, { onConflict: 'key' });
      if (error) toast("Erro ao salvar taxa.");
      else toast("Taxa de entrega atualizada!");
      refreshAdminStats();
    };
  };

  // --- Grid and Interaction Events ---
  $("productGrid").addEventListener("click", e => {
    const b = e.target.closest("[data-add]");
    if (b) showProduct(b.dataset.add);
  });

  $("categoryTabs").addEventListener("click", e => {
    const b = e.target.closest("[data-category]");
    if (!b) return;
    category = b.dataset.category;
    document.querySelectorAll(".category-tab").forEach(x => x.classList.toggle("active", x === b));
    productGrid();
  });

  $("searchInput").addEventListener("input", productGrid);
  $("openCart").onclick = openCart;
  $("overlay").onclick = closeLayers;
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeLayers);

  $("cartItems").addEventListener("click", e => {
    const b = e.target.closest("[data-qty]");
    if (!b) return;
    const item = cart[Number(b.dataset.qty)];
    item.quantity += Number(b.dataset.delta);
    if (item.quantity <= 0) cart.splice(Number(b.dataset.qty), 1);
    updateCartCount();
    renderCart();
  });

  $("goCheckout").onclick = () => {
    if (!cart.length) return;
    closeLayers();
    $("checkoutModal").classList.remove("hidden");
    updateCheckoutTotals();
  };

  $("fulfillment").onchange = updateCheckoutTotals;

  $("checkoutForm").onsubmit = async e => {
    e.preventDefault();
    if (!cart.length) return;
    const fulfillment = $("fulfillment").value;
    const address = fulfillment === "pickup"
      ? "Retirada no balcão"
      : `${$("customerStreet").value}, ${$("customerNumber").value} - ${$("customerNeighborhood").value} · CEP ${$("customerCep").value}${$("customerComplement").value ? " · " + $("customerComplement").value : ""}`;
    const payment = document.querySelector('input[name="payment"]:checked').value;
    const orderTotal = cartSubtotal() + (fulfillment === "delivery" ? deliveryFee : 0);
    const deliveryCode = fulfillment === "delivery" ? String(Math.floor(100000 + Math.random() * 900000)) : null;

    await checkSession();

    const { data: order, error } = await supabaseClient.from('orders').insert([{
      customer_name: $("customerName").value.trim(),
      customer_phone: $("customerPhone").value.trim(),
      address: address,
      fulfillment,
      payment,
      subtotal: cartSubtotal(),
      fee: fulfillment === "delivery" ? deliveryFee : 0,
      total: orderTotal,
      delivery_code: deliveryCode,
      status: 0,
      user_id: currentUser ? currentUser.id : null
    }]).select().single();

    if (error || !order) {
      toast("Erro ao pedir!");
      return;
    }

    await supabaseClient.from('order_items').insert(
      cart.map(i => ({
        order_id: order.id,
        product_id: i.id,
        name: i.name,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        extras: JSON.stringify(i.extras)
      }))
    );

    // Salvar localmente para histórico mesmo como convidado
    saveLocalOrderId(order.id);
    latestPlacedOrder = order;

    toast("Pedido realizado com sucesso!");
    $("successOrderNumber").textContent = "#" + order.id;
    $("successOrderTotal").textContent = money(order.total);
    $("successDeliveryCode").textContent = order.delivery_code || "RETIRADA";
    $("successDeliveryCode").parentElement.classList.toggle("hidden", fulfillment !== "delivery");

    cart = [];
    updateCartCount();
    e.target.reset();

    // Fecha sacola e modal de checkout antes de abrir o modal de sucesso
    closeLayers();
    $("successModal").classList.remove("hidden");
  };

  $("successTrack").onclick = () => {
    closeLayers();
    if (latestPlacedOrder) showTracking(latestPlacedOrder);
  };

  const successMyOrdersBtn = $("successMyOrders");
  if (successMyOrdersBtn) {
    successMyOrdersBtn.onclick = async () => {
      closeLayers();
      setPage("myOrdersPage");
      await loadMyOrders();
    };
  }

  $("trackShortcut").onclick = () => {
    setPage("trackingPage");
    $("trackingResult").innerHTML = "";
    $("trackNumber").focus();
  };

  $("trackForm").onsubmit = async e => {
    e.preventDefault();
    const { data: order } = await supabaseClient.from('orders').select('*').eq('id', $("trackNumber").value.trim()).single();
    if (order) showTracking(order);
    else $("trackingResult").innerHTML = '<p style="color:#ff9487;margin-top:20px">Pedido não encontrado.</p>';
  };

  // --- Auth Events ---
  $("authToggle").onclick = (e) => {
    e.preventDefault();
    const isLogin = $("authTitle").textContent === "Entrar";
    $("authTitle").textContent = isLogin ? "Cadastrar" : "Entrar";
    $("authDesc").textContent = isLogin ? "Crie sua conta para salvar e acompanhar seus pedidos." : "Acesse sua conta para ver seus pedidos.";
    $("authSubmit").textContent = isLogin ? "CADASTRAR E ENTRAR" : "ENTRAR";
    $("authToggleText").textContent = isLogin ? "Já tem uma conta?" : "Não tem uma conta?";
    $("authToggle").textContent = isLogin ? "Faça login" : "Cadastre-se aqui";

    const confirmGroup = $("authConfirmGroup");
    if (confirmGroup) {
      confirmGroup.classList.toggle("hidden", !isLogin);
      const confirmInput = $("authConfirmPassword");
      if (confirmInput) confirmInput.required = isLogin;
    }
  };

  $("authForm").onsubmit = async (e) => {
    e.preventDefault();
    const mode = $("authTitle").textContent === "Entrar" ? 'login' : 'signup';
    await handleAuth(mode);
  };

  const openGuestAuthBtn = $("openGuestAuthBtn");
  if (openGuestAuthBtn) {
    openGuestAuthBtn.onclick = (e) => {
      e.preventDefault();
      $("myOrdersAuth").classList.toggle("hidden");
      if (!$("myOrdersAuth").classList.contains("hidden")) {
        $("myOrdersAuth").scrollIntoView({ behavior: "smooth" });
      }
    };
  }

  const myOrdersLogoutBtn = $("myOrdersLogoutBtn");
  if (myOrdersLogoutBtn) {
    myOrdersLogoutBtn.onclick = async () => {
      await supabaseClient.auth.signOut();
      currentUser = null;
      toast("Você saiu da conta.");
      await loadMyOrders();
    };
  }

  // --- Admin Events ---
  const getAdminCredentials = () => {
    try {
      const saved = localStorage.getItem("sb_admin_creds");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { email: "admin@simpson.com", password: "admin1234" };
  };

  $("adminShortcut").onclick = () => {
    setPage("adminPage");
    $("adminLogin").classList.remove("hidden");
    $("adminDashboard").classList.add("hidden");
  };

  $("loginForm").onsubmit = async e => {
    e.preventDefault();
    $("loginError").textContent = "";
    const email = $("adminEmail")?.value.trim().toLowerCase() || "";
    const password = $("adminPassword")?.value.trim() || "";
    const creds = getAdminCredentials();

    let authenticated = false;

    // 1. Verifica credenciais diretas do administrador
    if (email === creds.email.toLowerCase() && password === creds.password) {
      authenticated = true;
    } else {
      // 2. Ou autenticação com Supabase Auth (se conta admin cadastrada)
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (!error && data?.session) {
          if (email === creds.email.toLowerCase() || email.includes("admin")) {
            authenticated = true;
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    if (authenticated) {
      adminAuthenticated = true;
      $("adminLogin").classList.add("hidden");
      $("adminDashboard").classList.remove("hidden");
      $("logoutButton").classList.remove("hidden");
      $("adminOrderDate").value = adminFilterDate;
      refreshAdminStats();
      renderOrdersList();
      renderAdminProducts();
      supabaseClient.channel('orders_channel').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        toast("🔔 Novo pedido recebido!");
      }).subscribe();
    } else {
      $("loginError").textContent = "E-mail ou senha de administrador incorretos!";
    }
  };

  $("logoutButton").onclick = () => {
    adminAuthenticated = false;
    setPage("homePage");
    if ($("adminEmail")) $("adminEmail").value = "";
    if ($("adminPassword")) $("adminPassword").value = "";
    $("adminLogin").classList.remove("hidden");
    $("adminDashboard").classList.add("hidden");
    $("logoutButton").classList.add("hidden");
  };

  document.querySelectorAll("[data-admin-tab]").forEach(b => b.onclick = () => {
    const tab = b.dataset.adminTab;
    document.querySelectorAll("[data-admin-tab]").forEach(x => x.classList.toggle("active", x === b));
    ["orders", "products", "delivery"].forEach(k => {
      const el = $("admin" + k[0].toUpperCase() + k.slice(1));
      if (el) el.classList.toggle("hidden", k !== tab);
    });
    if (tab === 'delivery') renderDeliverySettings();
  });

  $("filterOrdersBtn").onclick = async () => {
    adminFilterDate = $("adminOrderDate").value;
    if (!adminFilterDate) { toast("Selecione uma data!"); return; }
    await loadOrders();
    refreshAdminStats();
  };

  // --- In-Page Anchor Links (Smooth scroll para seções do cardápio e sobre) ---
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    const target = link.getAttribute('href');
    if (link.dataset.page || !target || target === '#' || target.length <= 1) return;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      const id = target.substring(1);
      const el = document.getElementById(id);
      if (el) {
        setPage("homePage");
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 50);
      }
    });
  });

  // --- SPA Navigation (Links entre páginas com data-page) ---
  document.querySelectorAll("[data-page]").forEach(b => {
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      const page = b.dataset.page === "home" ? "homePage" : b.dataset.page;
      setPage(page);
      if (page === "myOrdersPage") {
        await loadMyOrders();
      }
    });
  });

  // --- Mobile Menu Toggle ---
  const menuToggle = $("menuToggle");
  const mainNav = document.querySelector(".main-nav");
  if (menuToggle && mainNav) {
    menuToggle.onclick = () => {
      mainNav.classList.toggle("open");
    };
    mainNav.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => mainNav.classList.remove("open"));
    });
  }

  $("year").textContent = new Date().getFullYear();

  // --- Inicialização ---
  (async () => {
    await checkSession();
    await loadSettings();
    await loadProducts();
    await loadOrders();
  })();

})();
