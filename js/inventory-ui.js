// Inventory writes go through server-authorized, atomic RPCs. Stacks are visual only.
function createInventoryUI({
  client,
  getCharacter,
  getWorld,
  getItems,
  reload,
  onUse,
  notify,
  isBusy,
  notifySuccess = true,
  onGiven = null,
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'workspace-dialog';
  dialog.setAttribute('aria-label', 'Inventory');
  dialog.innerHTML =
    '<div class="workspace-dialog-header"><h2>Inventory</h2><button type="button" data-close>Close</button></div><p id="inventory-count"></p><div class="inventory-stacks"></div><p role="status" class="inventory-status"></p>';
  document.body.append(dialog);
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Manage inventory';
  document.getElementById('inventory').after(button);
  let busy = false,
    pending = null,
    pendingShow = null,
    groundBusy = false;

  const label = (item) => APSUItems.name(item, getWorld());

  button.onclick = async () => {
    dialog.showModal();
    try {
      await reload();
      render();
    } catch {
      dialog.querySelector('.inventory-status').textContent = 'Could not load inventory.';
    }
  };

  async function action(item, action, target = null, group = [item], quantity = 1, message = '') {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > group.length || quantity > 100) {
      dialog.close();
      notify('Invalid quantity. You have ' + group.length + ' available (maximum 100 per action).');
      return;
    }
    if (busy || isBusy()) {
      notify('Finish your current interaction first.');
      return;
    }
    if (
      action === 'delete' &&
      !(await APSUUI.confirm({
        title: 'Delete item?',
        message: 'Permanently delete ' + quantity + ' × ' + label(item) + '?',
        confirmLabel: 'Delete',
      }))
    )
      return;

    const c = getCharacter();

    if (!c) return;

    busy = true;
    const status = dialog.querySelector('.inventory-status');
    status.textContent = 'Saving…';
    const args =
        action === 'pickup'
          ? { p_character: c.id, p_item: item.id, p_action: action, p_target: target }
          : {
              p_character: c.id,
              p_items: group.slice(0, quantity).map((i) => i.id),
              p_action: action,
              p_target: target,
            },
      signature = JSON.stringify(args);

    if (!pending || pending.signature !== signature)
      pending = { signature, id: crypto.randomUUID() };
    try {
      const { error } = await client.rpc(
        action === 'pickup' ? 'inventory_action' : 'inventory_batch',
        { ...args, p_request: pending.id },
      );

      if (error) throw error;

      pending = null;
      await reload();
      render();
      await refreshGround();
      status.textContent = '';
      if (action === 'give' && onGiven) {
        dialog.close();
        onGiven({ target, message, itemName: label(item), quantity });
      }
      if (notifySuccess)
        notify(
          action === 'give'
            ? 'Item given.'
            : action === 'drop'
              ? 'Item dropped.'
              : action === 'pickup'
                ? 'Picked up ' + label(item) + '.'
                : 'Item deleted.',
        );
    } catch (e) {
      status.textContent = e.message || 'Could not update inventory.';
      dialog.close();
      notify(status.textContent);
    } finally {
      busy = false;
    }
  }

  function render() {
    const items = getItems(),
      count = items.filter((i) => i.kind === 'lockpick' && i.capacity > 0).length;
    document.getElementById('inventory').textContent = items.length + ' items';
    if (!dialog.open) return;

    dialog.querySelector('#inventory-count').textContent = items.length + ' items';
    const list = dialog.querySelector('.inventory-stacks');
    list.replaceChildren();
    const groups = new Map();

    for (const item of items) {
      const key = APSUItems.stackKey(item);

      if (!groups.has(key)) groups.set(key, []);

      groups.get(key).push(item);
    }
    if (!groups.size) list.textContent = 'Your inventory is empty.';
    for (const group of groups.values()) {
      const item = group[0],
        box = document.createElement('article');
      box.className = 'inventory-stack';
      const title = document.createElement('strong');
      title.textContent = label(item);
      const quantity = document.createElement('span');
      quantity.className = 'item-quantity';
      quantity.textContent = '×' + group.length;
      box.append(APSUItems.visual(item.appearance, client), title, quantity);
      if (item.detailLabel) {
        const detail = document.createElement('p');
        detail.textContent = item.detailLabel;
        box.append(detail);
      }
      if (item.valueLabel) {
        const value = document.createElement('span');
        value.className = 'item-value';
        value.textContent = item.valueLabel;
        box.append(value);
      }

      const actions = document.createElement('div');
      actions.className = 'inventory-actions';
      const quantityLabel = document.createElement('label');
      quantityLabel.textContent = 'Quantity ';
      const amount = document.createElement('input');
      amount.type = 'number';
      amount.min = '1';
      amount.step = '1';
      amount.value = '1';
      amount.style.width = '80px';
      amount.setAttribute('aria-label', 'Quantity of ' + label(item));
      quantityLabel.append(amount);
      actions.append(quantityLabel);
      const use = document.createElement('button');
      use.textContent = item.usableKey
        ? 'Use key'
        : item.equippable
          ? 'Equip'
          : item.consumable
            ? 'Drink serving'
            : item.kind === 'custom'
              ? 'Inspect'
              : 'Use';
      use.disabled = item.kind === 'lockpick' && item.capacity === 0;
      use.onclick = () => {
        if (busy || isBusy()) return;

        dialog.close();
        if (item.kind === 'custom' && !item.consumable && !item.equippable && !item.usableKey)
          APSUItems.inspect(item, getWorld(), client);
        else onUse(item);
      };
      actions.append(use);
      for (const [text, verb] of [
        ['Drop', 'drop'],
        ['Delete', 'delete'],
      ]) {
        const b = document.createElement('button');
        b.textContent = text;
        b.onclick = () => action(item, verb, null, group, Number(amount.value));
        actions.append(b);
      }

      const recipients = document.createElement('select');
      recipients.setAttribute('aria-label', 'Give ' + label(item) + ' to');
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose character';
      recipients.append(placeholder);
      document.querySelectorAll('#room-characters button[data-character-id]').forEach((b) => {
        if (b.dataset.characterId === getCharacter()?.id) return;

        const o = document.createElement('option');
        o.value = b.dataset.characterId;
        o.textContent = b.dataset.characterName;
        recipients.append(o);
      });
      const giveMessage = document.createElement('input');

      if (onGiven) {
        giveMessage.maxLength = 500;
        giveMessage.placeholder = 'Optional message with this gift';
        giveMessage.setAttribute('aria-label', 'Message with ' + label(item));
        actions.append(giveMessage);
      }

      const give = document.createElement('button');
      give.textContent = 'Give';
      give.onclick = () => {
        if (
          !Number.isInteger(Number(amount.value)) ||
          Number(amount.value) < 1 ||
          Number(amount.value) > group.length ||
          Number(amount.value) > 100
        ) {
          action(item, 'give', null, group, Number(amount.value));
          return;
        }
        if (!recipients.value) {
          dialog.querySelector('.inventory-status').textContent =
            'Choose a character in this room.';
          return;
        }

        action(
          item,
          'give',
          recipients.value,
          group,
          Number(amount.value),
          giveMessage.value.trim(),
        );
      };
      const show = document.createElement('button');
      show.type = 'button';
      show.textContent = 'Show item';
      show.onclick = async () => {
        if (busy || isBusy()) return;
        if (!recipients.value) {
          dialog.querySelector('.inventory-status').textContent =
            'Choose a character in this room.';
          return;
        }

        const c = getCharacter(),
          target = recipients.value;

        if (!pendingShow || pendingShow.item !== item.id || pendingShow.target !== target)
          pendingShow = { id: crypto.randomUUID(), item: item.id, target };

        busy = true;
        show.disabled = true;
        try {
          const { error } = await client.rpc('show_inventory_item', {
            p_id: pendingShow.id,
            p_character: c.id,
            p_item: item.id,
            p_target: target,
          });

          if (error) throw error;

          pendingShow = null;
          dialog.querySelector('.inventory-status').textContent =
            'Item shown. It stays in your inventory.';
        } catch (e) {
          dialog.querySelector('.inventory-status').textContent =
            e.code === 'PGRST202' ? 'Showing items needs the prepared database update.' : e.message;
        } finally {
          busy = false;
          show.disabled = false;
        }
      };
      actions.append(recipients, give, show);
      box.append(actions);
      list.append(box);
    }
  }

  async function refreshGround() {
    if (groundBusy || !getCharacter()) return;

    groundBusy = true;
    const c = getCharacter(),
      room = c.location;

    try {
      const { data, error } = await client.rpc('room_ground_items', { p_character: c.id });

      if (error) return;
      if (getCharacter() !== c || c.location !== room) return;

      let list = document.getElementById('dropped-items');

      if (!list) {
        list = document.createElement('div');
        list.id = 'dropped-items';
        document.getElementById('room-items').after(list);
      }

      list.replaceChildren();
      for (const item of data || []) {
        const row = document.createElement('div'),
          name = document.createElement('span'),
          b = document.createElement('button');
        name.textContent = label(item) + ' ';
        b.textContent = 'Pick up';
        b.onclick = () => action(item, 'pickup');
        row.className = 'ground-item';
        row.append(APSUItems.visual(item.appearance, client), name, b);
        if (item.valueLabel) {
          const value = document.createElement('span');
          value.className = 'item-value';
          value.textContent = item.valueLabel;
          row.append(value);
        }

        list.append(row);
      }
    } catch {
    } finally {
      groundBusy = false;
    }
  }

  return { render, refreshGround, isBusy: () => busy };
}
