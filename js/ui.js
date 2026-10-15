// Shared APSU feedback: keep validation rules, replace browser-owned bubbles.
(() => {
  document.addEventListener(
    'pointerdown',
    () => {
      document.documentElement.dataset.inputMode = 'pointer';
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key))
        document.documentElement.dataset.inputMode = 'keyboard';
    },
    true,
  );
  // Dismiss the top dialog only when a complete pointer gesture is on its backdrop.
  // Dispatching cancel lets the lock minigame release its lease through its existing handler.
  let backdropPress = null;

  const onBackdrop = (event) => {
    const dialog = event.target;

    if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return null;

    const rect = dialog.getBoundingClientRect();

    return event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
      ? dialog
      : null;
  };

  document.addEventListener('pointerdown', (event) => {
    backdropPress = event.button === 0 ? { dialog: onBackdrop(event), id: event.pointerId } : null;
  });
  document.addEventListener('pointerup', (event) => {
    const pressed = backdropPress;
    backdropPress = null;
    const dialog = onBackdrop(event);

    if (!dialog || pressed?.dialog !== dialog || pressed.id !== event.pointerId) return;
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close('');
  });
  document.addEventListener('pointercancel', () => {
    backdropPress = null;
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'password-control';
      input.before(wrapper);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'password-toggle';
      const secretName = input.dataset.secretLabel || 'password';
      toggle.textContent = 'Show ' + secretName;
      toggle.setAttribute('aria-controls', input.id);
      toggle.setAttribute('aria-pressed', 'false');
      toggle.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.textContent = (show ? 'Hide ' : 'Show ') + secretName;
        toggle.setAttribute('aria-pressed', String(show));
      });
      wrapper.append(input, toggle);
    });
  });
  let nextError = 0,
    pendingConfirmation = null;

  function messageFor(field) {
    const name =
      field.id === 'chat-input'
        ? 'message'
        : (
            field.labels?.[0]?.textContent.trim().replace(/:$/, '') ||
            field.name ||
            'value'
          ).toLowerCase();

    if (field.type === 'checkbox' && field.required && !field.checked)
      return 'Please review and check this agreement before continuing.';
    if (field.validity.valueMissing || (field.required && !field.value.trim()))
      return 'Please enter your ' + name + '.';
    if (field.validity.typeMismatch && field.type === 'email')
      return 'Enter a valid email address, such as name@example.com.';
    if (field.validity.tooShort) return 'Use at least ' + field.minLength + ' characters.';
    if (field.validity.tooLong) return 'Use no more than ' + field.maxLength + ' characters.';
    if (field.validity.rangeUnderflow) return 'Enter a value of at least ' + field.min + '.';
    if (field.validity.rangeOverflow) return 'Enter a value no greater than ' + field.max + '.';

    return 'Please check this ' + name + '.';
  }

  const errors = new WeakMap();

  function clearError(field) {
    const error = errors.get(field);

    if (!error) return;

    field.removeAttribute('aria-invalid');
    const described = (field.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== error.id);

    if (described.length) field.setAttribute('aria-describedby', described.join(' '));
    else field.removeAttribute('aria-describedby');

    error.remove();
    errors.delete(field);
  }

  document.addEventListener('invalid', (event) => event.preventDefault(), true);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('form').forEach((form) => {
      form.noValidate = true;
    });
  });
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;

      if (!(form instanceof HTMLFormElement)) return;

      const invalid = [...form.elements].filter(
        (field) =>
          field.willValidate && (!field.validity.valid || (field.required && !field.value.trim())),
      );

      if (!invalid.length) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      for (const field of invalid) {
        clearError(field);
        const error = document.createElement('p');
        error.id = 'apsu-field-error-' + ++nextError;
        error.className = 'field-feedback';
        error.setAttribute('role', 'alert');
        error.textContent = messageFor(field);
        field.insertAdjacentElement('afterend', error);
        errors.set(field, error);
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute(
          'aria-describedby',
          [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '),
        );
      }

      invalid[0].focus();
    },
    true,
  );
  document.addEventListener('input', (event) => clearError(event.target));
  window.APSUUI = {
    confirm({
      title = 'Leave room?',
      message,
      confirmLabel = 'Leave room',
      cancelLabel = 'Cancel',
    }) {
      if (pendingConfirmation) return pendingConfirmation;

      pendingConfirmation = new Promise((resolve) => {
        const previousFocus = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.className = 'apsu-confirm';
        dialog.setAttribute('aria-labelledby', 'apsu-confirm-title');
        dialog.setAttribute('aria-describedby', 'apsu-confirm-message');
        const heading = document.createElement('h2');
        heading.id = 'apsu-confirm-title';
        heading.textContent = title;
        const body = document.createElement('p');
        body.id = 'apsu-confirm-message';
        body.textContent = message;
        const actions = document.createElement('div');
        actions.className = 'apsu-confirm-actions';
        const stay = document.createElement('button');
        stay.type = 'button';
        stay.textContent = cancelLabel;
        stay.autofocus = true;
        const leave = document.createElement('button');
        leave.type = 'button';
        leave.textContent = confirmLabel;
        stay.addEventListener('click', () => dialog.close('stay'));
        leave.addEventListener('click', () => dialog.close('leave'));
        dialog.addEventListener(
          'close',
          () => {
            const confirmed = dialog.returnValue === 'leave';
            dialog.remove();
            pendingConfirmation = null;
            if (previousFocus?.isConnected) previousFocus.focus();

            resolve(confirmed);
          },
          { once: true },
        );
        actions.append(stay, leave);
        dialog.append(heading, body, actions);
        document.body.append(dialog);
        dialog.showModal();
      });
      return pendingConfirmation;
    },
  };
})();
