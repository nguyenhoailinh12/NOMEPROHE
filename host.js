document.addEventListener('DOMContentLoaded', () => {
  const svcType = document.getElementById('svc-type');
  const ramRange = document.getElementById('ram-range');
  const cpuRange = document.getElementById('cpu-range');
  const ssdRange = document.getElementById('ssd-range');
  const ramVal = document.getElementById('ram-val');
  const cpuVal = document.getElementById('cpu-val');
  const ssdVal = document.getElementById('ssd-val');
  const priceVal = document.getElementById('price-val');
  const applyBtn = document.getElementById('apply-custom');
  const selectedPlan = document.getElementById('selected-plan');
  const orderForm = document.getElementById('order-form');
  const orderStatus = document.getElementById('order-status');

  // Simple pricing model (tùy chỉnh theo thực tế)
  function calcPrice() {
    const type = svcType.value; // 'MC' or 'VPS'
    const ram = Number(ramRange.value);
    const cpu = Number(cpuRange.value);
    const ssd = Number(ssdRange.value);

    // Base prices and multipliers
    const base = type === 'MC' ? 50000 : 80000; // base per month
    const ramFactor = type === 'MC' ? 15000 : 20000; // per GB
    const cpuFactor = type === 'MC' ? 20000 : 30000; // per vCPU
    const ssdFactor = 1000; // per GB

    const price = base + ram * ramFactor + cpu * cpuFactor + ssd * ssdFactor;
    return price;
  }

  function formatVND(x) {
    return x.toLocaleString('vi-VN') + '₫';
  }

  function updateView() {
    ramVal.textContent = ramRange.value;
    cpuVal.textContent = cpuRange.value;
    ssdVal.textContent = ssdRange.value;
    priceVal.textContent = formatVND(calcPrice());
  }

  svcType.addEventListener('change', updateView);
  ramRange.addEventListener('input', updateView);
  cpuRange.addEventListener('input', updateView);
  ssdRange.addEventListener('input', updateView);

  // Apply custom plan into selected-plan field
  applyBtn.addEventListener('click', () => {
    const summary = `${svcType.value} • RAM ${ramRange.value}GB • vCPU ${cpuRange.value} • NVMe ${ssdRange.value}GB • ${priceVal.textContent}/tháng`;
    selectedPlan.value = summary;
    orderStatus.textContent = 'Đã áp dụng gói tuỳ chỉnh vào đơn hàng.';
  });

  // Attach click handlers for fixed plans
  document.querySelectorAll('[data-select-plan]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const plan = JSON.parse(btn.getAttribute('data-select-plan'));
        selectedPlan.value = `${plan.type} • ${plan.name} • ${plan.price.toLocaleString('vi-VN')}₫/tháng`;
        orderStatus.textContent = `Đã chọn gói ${plan.name}.`;
        window.scrollTo({ top: document.getElementById('contact').offsetTop - 20, behavior: 'smooth' });
      } catch {}
    });
  });

  orderForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('buyer-name').value.trim(),
      contact: document.getElementById('buyer-contact').value.trim(),
      plan: selectedPlan.value.trim(),
      note: document.getElementById('note').value.trim(),
      at: new Date().toISOString(),
    };

    if (!payload.name || !payload.contact) {
      orderStatus.textContent = 'Vui lòng nhập đầy đủ thông tin liên hệ.';
      return;
    }

    // Hiện tại: chỉ log ra console. Bạn có thể POST tới backend của bạn tại đây.
    console.log('Yêu cầu đặt hàng:', payload);
    orderStatus.textContent = 'Đã gửi yêu cầu! Chúng tôi sẽ liên hệ sớm qua Email/Discord.';
    orderForm.reset();
    selectedPlan.value = '';
  });

  // Init
  updateView();
});
