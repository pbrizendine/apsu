(() => {
  const $ = (id) => document.getElementById(id),
    tabs = [$('multiplayer-tab'), $('singleplayer-tab')];

  function select(index, focus = false) {
    tabs.forEach((t, i) => {
      t.setAttribute('aria-selected', String(i === index));
      t.tabIndex = i === index ? 0 : -1;
    });
    $('multiplayer-panel').hidden = index !== 0;
    $('singleplayer-panel').hidden = index !== 1;
    if (focus) tabs[index].focus();
    if (index === 1) refresh();
  }

  tabs.forEach((t, i) => {
    t.onclick = () => select(i);
    t.onkeydown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        select(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : 1 - i, true);
      }
    };
  });
  const status = $('solo-library-status'),
    dialog = $('create-solo-dialog');

  function button(label, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = handler;

    return b;
  }

  async function refresh() {
    try {
      const worlds = await APSUSoloStore.list();
      $('solo-worlds').replaceChildren();
      status.textContent = worlds.length
        ? 'Download backups before clearing browser data.'
        : 'No local worlds yet. Create your first world or import a save.';
      worlds
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .forEach((w) => {
          const card = document.createElement('article');
          card.className = 'world-card';
          const title = document.createElement('h3');
          title.textContent = w.title;
          const info = document.createElement('p');
          info.textContent = `${w.player.name} · ${APSUSoloEngine.roomsFor(w)[w.player.room]?.name || 'Unknown location'} · ${w.completed ? 'Objective complete' : 'In progress'}`;
          const date = document.createElement('p');
          date.textContent = 'Last saved ' + new Date(w.updatedAt).toLocaleString();
          const actions = document.createElement('div');
          actions.className = 'world-actions';
          actions.append(
            button('Continue', () => {
              location.href = 'solo.html?save=' + encodeURIComponent(w.id);
            }),
            button('Download Save', async () => {
              try {
                APSUSoloStore.download(await APSUSoloStore.get(w.id));
              } catch (e) {
                status.textContent = e.message;
              }
            }),
            button('Delete', async () => {
              if (
                !(await APSUUI.confirm({
                  title: 'Delete local world?',
                  message: 'Download a backup first if you want to keep this world.',
                  confirmLabel: 'Delete',
                }))
              )
                return;
              try {
                await APSUSoloStore.remove(w.id);
                await refresh();
              } catch (e) {
                status.textContent = e.message;
              }
            }),
          );
          card.append(title, info, date, actions);
          $('solo-worlds').append(card);
        });
    } catch (e) {
      status.textContent = e.message;
    }
  }

  let generatedDesign = null,
    generating = false,
    creation = null,
    savedDraft = null,
    paused = false;
  const G = APSUSoloGeneration,
    drafts = APSUSoloGenerationStore;

  function generationMode() {
    const generated = $('solo-world-type').value === 'generated';
    document.querySelector('#create-solo-dialog > p').hidden = generated;
    $('world-generation').hidden = !generated;
    $('begin-solo').disabled = generating || (generated && !generatedDesign);
    for (const id of [
      'solo-world-type',
      'world-prompt',
      'world-model',
      'world-custom-model',
      'world-key',
      'world-paid',
      'world-adult',
    ])
      $(id).disabled = generating;

    $('generate-world').disabled = generating || !!generatedDesign;
    $('pause-generation').hidden = !generating;
    $('generate-world').textContent =
      creation?.step && creation.prompt === $('world-prompt').value.trim()
        ? generatedDesign
          ? 'World creation complete'
          : 'Continue world creation'
        : 'Create my world · 4 stages';
  }

  function paintCreation() {
    const active = creation?.prompt === $('world-prompt').value.trim() ? creation : null;
    G.progressStages(active, generating).forEach((stage, i) => {
      const list = $('generation-steps');
      let row = list.children[i];

      if (!row) {
        row = document.createElement('li');
        const label = document.createElement('span');
        label.className = 'generation-label';
        row.append(label);
        list.append(row);
      }

      row.setAttribute(
        'aria-label',
        'Stage ' +
          (i + 1) +
          (stage.complete ? ', complete' : stage.current ? ', in progress' : ', pending'),
      );
      row.classList.toggle('generation-current', stage.current);
      row.classList.toggle('generation-complete', stage.complete);
      row.classList.toggle('generation-revealed', stage.revealed);
      if (stage.current) row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');

      row.firstChild.textContent = stage.revealed ? stage.title : '';
    });
    const preview = $('world-preview');
    preview.replaceChildren();
    if (!active?.blueprint) return;

    const w = active.blueprint,
      title = document.createElement('h3'),
      premise = document.createElement('p'),
      counts = document.createElement('p'),
      map = document.createElement('div');
    title.textContent = w.title;
    premise.textContent = w.premise;
    counts.className = 'creation-counts';
    counts.textContent = `${w.zones.length} areas · ${w.rooms.length} places · ${w.characters.length} people · ${w.items.length} objects`;
    map.className = 'creation-map';
    renderWorldMap(map, Object.fromEntries(w.rooms.map((r) => [r.id, r])), w.start, {
      explorer: true,
      zones: w.zones,
    });
    preview.append(title, premise, counts, map);
    for (const notice of active.notices || []) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = notice;
      preview.append(p);
    }

    const places = document.createElement('div');
    places.className = 'creation-places';
    for (const zone of w.zones) {
      const block = document.createElement('details'),
        label = document.createElement('summary');
      label.textContent = zone.name;
      block.append(label);
      for (const r of w.rooms.filter((r) => r.zone === zone.id)) {
        const heading = document.createElement('h4'),
          text = document.createElement('p');
        heading.textContent = r.name;
        text.textContent = r.description;
        block.append(heading, text);
      }

      places.append(block);
    }

    const cast = document.createElement('div');
    cast.className = 'creation-cast';
    for (const c of w.characters) {
      const card = document.createElement('article'),
        name = document.createElement('h4'),
        desc = document.createElement('p');
      name.textContent = c.name;
      desc.textContent = c.description;
      card.append(name, desc);
      cast.append(card);
    }

    preview.append(places, cast);
  }

  async function saveCreation() {
    await drafts.save(creation);
    savedDraft = creation;
    $('resume-solo').hidden = false;
  }

  function generationKey() {
    if ($('world-key').value.trim()) return $('world-key').value.trim();
    try {
      return globalThis.APSUSoloConnection?.load()?.key || '';
    } catch {
      return '';
    }
  }

  function resetCreationForm() {
    $('create-solo-form').reset();
    for (const id of [
      'solo-name',
      'solo-description',
      'world-prompt',
      'world-key',
      'world-custom-model',
    ])
      $(id).value = '';

    $('world-key').placeholder = generationKey()
      ? 'Using your remembered OpenRouter key; enter another to override'
      : 'OpenRouter API key';
    for (const id of ['world-paid', 'world-adult']) $(id).checked = false;

    $('world-custom-model').hidden = true;
    $('world-paid-field').hidden = true;
    creation = null;
    generatedDesign = null;
    paused = false;
    $('generation-status').textContent = '';
    $('solo-create-error').textContent = '';
    paintCreation();
    generationMode();
  }

  const ready = drafts
    .load()
    .then((value) => {
      savedDraft = value;
      $('resume-solo').hidden = !value;
    })
    .catch((e) => {
      status.textContent = e.message;
    });
  $('resume-solo').onclick = async () => {
    await ready;
    if (generating || !savedDraft) return;

    resetCreationForm();
    creation = savedDraft;
    $('solo-world-type').value = 'generated';
    $('world-prompt').value = creation.prompt;
    generatedDesign = creation.step === 4 ? creation.blueprint : null;
    $('generation-status').textContent =
      'Resumed creation · ' +
      creation.step +
      ' of 4 stages complete. Approve the next requests to continue.';
    paintCreation();
    generationMode();
    dialog.showModal();
  };
  $('solo-world-type').onchange = generationMode;
  $('world-model').onchange = () => {
    const custom = $('world-model').value === 'custom';
    $('world-custom-model').hidden = !custom;
    $('world-paid-field').hidden = !custom;
  };
  $('world-prompt').oninput = () => {
    generatedDesign =
      creation?.prompt === $('world-prompt').value.trim() && creation.step === 4
        ? creation.blueprint
        : null;
    paintCreation();
    generationMode();
  };
  $('pause-generation').onclick = () => {
    paused = true;
    $('generation-status').textContent =
      'Finishing this stage, then pausing. Completed work will stay saved.';
  };
  $('generate-world').onclick = async () => {
    if (generating) return;

    await ready;
    const model =
      $('world-model').value === 'custom'
        ? $('world-custom-model').value.trim()
        : $('world-model').value;

    if (
      !$('world-adult').checked ||
      !$('world-prompt').value.trim() ||
      !/^sk-or-v1-[\w-]{20,250}$/.test(generationKey()) ||
      (!model.endsWith(':free') && !$('world-paid').checked)
    ) {
      $('generation-status').textContent =
        'Enter your setting and key, and approve the generation requests. Paid models require explicit approval.';
      return;
    }

    generating = true;
    paused = false;
    generatedDesign = null;
    generationMode();
    try {
      if (!creation || creation.prompt !== $('world-prompt').value.trim())
        creation = G.draft({ prompt: $('world-prompt').value.trim(), step: 0, receipts: [] });

      await saveCreation(); // Verify durable storage before consuming a request.
      while (creation.step < G.stages.length && !paused) {
        creation.reachedStage = creation.step;
        const stage = G.displayStages(creation)[creation.step];
        paintCreation();
        $('generation-status').textContent =
          `${stage.title} · ${stage.detail} (${creation.step + 1} of 4)`;
        creation.receipts.push({ cost: null, input: null, output: null });
        await saveCreation();
        const response = await fetch('/api/solo-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: creation.prompt,
            key: generationKey(),
            model,
            adult: true,
            allowPaid: $('world-paid').checked,
            stage: stage.id,
            ...(creation.step ? { blueprint: creation.blueprint } : {}),
          }),
          signal: AbortSignal.timeout(100000),
        });
        const data = await response.json();
        creation.receipts[creation.receipts.length - 1] = data.usage || { cost: null };
        if (!response.ok) {
          await saveCreation();
          throw Error(data.error || 'This stage could not be completed.');
        }

        const blueprint = APSUSoloBlueprint.validate(data.blueprint);
        creation = G.draft({
          ...creation,
          blueprint,
          step: creation.step + 1,
          stageTitles: G.cleanTitles(data.stageTitles) || creation.stageTitles,
          notices: [
            ...(creation.notices || []),
            ...(Array.isArray(data.warnings) ? data.warnings : []),
          ],
        });
        await saveCreation(); // Never begin the next paid/free stage until this is saved.
        paintCreation();
      }

      generatedDesign = creation.step === 4 ? creation.blueprint : null;
      const receipts = creation.receipts.filter((r) => r.cost !== null),
        cost = receipts.reduce((n, r) => n + r.cost, 0);
      $('generation-status').textContent =
        (generatedDesign
          ? 'Your world is ready. Explore the preview, then enter as your character.'
          : `Paused · ${creation.step} of 4 stages saved. Continue whenever you are ready.`) +
        ` Provider-reported cost: $${cost.toFixed(4)} (${receipts.length}/${creation.receipts.length} attempts have receipts; missing costs are unknown).`;
    } catch (e) {
      $('generation-status').textContent =
        e.message +
        ` ${creation?.step || 0} of 4 stages complete. Continue retries only this unfinished stage; completed stages are kept.`;
    } finally {
      generating = false;
      paintCreation();
      generationMode();
    }
  };
  dialog.addEventListener('close', () => {
    paused = true;
    $('world-key').value = '';
  });
  $('create-solo').onclick = async () => {
    await ready;
    if (generating) {
      status.textContent = 'Wait for the current creation stage to finish.';
      return;
    }

    resetCreationForm();
    dialog.showModal();
    $('solo-name').focus();
  };
  $('cancel-solo-create').onclick = () => dialog.close();
  $('create-solo-form').onsubmit = async (e) => {
    e.preventDefault();
    const b = e.submitter;

    if (b.disabled) return;

    b.disabled = true;
    try {
      const world = await APSUSoloStore.save(
        $('solo-world-type').value === 'generated'
          ? APSUSoloEngine.createGenerated(
              generatedDesign,
              $('solo-name').value,
              $('solo-description').value,
            )
          : APSUSoloEngine.createMercer($('solo-name').value, $('solo-description').value),
        true,
      );

      if ($('solo-world-type').value === 'generated') {
        try {
          await drafts.clear();
          savedDraft = null;
          $('resume-solo').hidden = true;
        } catch (error) {
          status.textContent =
            'World saved, but its old creation draft could not be cleared: ' + error.message;
        }
      }

      navigator.storage?.persist?.().catch(() => {});
      location.href = 'solo.html?save=' + encodeURIComponent(world.id);
    } catch (error) {
      $('solo-create-error').textContent = error.message;
      b.disabled = false;
    }
  };
  $('import-solo').onclick = () => $('solo-file').click();
  $('solo-file').onchange = async () => {
    const file = $('solo-file').files[0];

    if (!file) return;
    try {
      await APSUSoloStore.importFile(file);
      await refresh();
      status.textContent = 'Save imported as a separate world. Your existing saves are unchanged.';
    } catch (e) {
      status.textContent = e.message;
    } finally {
      $('solo-file').value = '';
    }
  };
  select(location.hash === '#single-player' ? 1 : 0);
})();
