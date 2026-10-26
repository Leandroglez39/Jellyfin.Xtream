// Selection per category: undefined = none, [] = whole category, [ids] = those channels.
const isSelected = (data, categoryId, channelId) => {
  const live = data[categoryId];
  return live !== undefined && (live.length === 0 || live.includes(channelId));
};

const categoryRow = (view, categoryId) =>
  view.querySelector(`#LiveContent > tr[data-category-id="${categoryId}"]`);

// Search toggles change the data directly, so the category table must be told.
const refreshCategoryRow = (view, data, categoryId) => {
  const row = categoryRow(view, categoryId);
  if (!row) {
    return;
  }

  const live = data[categoryId];
  const checkbox = row.querySelector(':scope > td:first-child > input');
  checkbox.indeterminate = live !== undefined && live.length > 0;
  checkbox.checked = live !== undefined && live.length === 0;
  row.querySelectorAll('tr[data-item-id]').forEach((itemRow) => {
    itemRow.querySelector('input').checked = isSelected(data, categoryId, Number(itemRow.dataset.itemId));
  });
};

const setChannel = async (Xtream, data, categoryId, channelId, checked) => {
  let live = data[categoryId];
  if (checked) {
    if (live === undefined) {
      live = [channelId];
    } else if (live.length > 0 && !live.includes(channelId)) {
      live = [...live, channelId];
    }
  } else if (live !== undefined) {
    if (live.length === 0) {
      // Unticking one channel of a whole category needs the rest of that category listed.
      const items = await Xtream.fetchJson(`Xtream/LiveCategories/${categoryId}`);
      live = items.map((i) => i.Id);
    }

    live = live.filter((id) => id !== channelId);
    if (live.length === 0) {
      live = undefined;
    }
  }

  data[categoryId] = live;
};

const applyCategoryFilter = (view, data) => {
  const text = view.querySelector('#CategoryFilter').value.trim().toLowerCase();
  const onlySelected = view.querySelector('#OnlySelected').checked;
  let shown = 0;
  let total = 0;
  let selected = 0;
  view.querySelectorAll('#LiveContent > tr[data-category-id]').forEach((row) => {
    const id = row.dataset.categoryId;
    const name = row.children[1].innerText.toLowerCase();
    const hasSelection = data[id] !== undefined;
    const visible = (!text || name.includes(text)) && (!onlySelected || hasSelection);
    row.hidden = !visible;
    total++;
    shown += visible ? 1 : 0;
    selected += hasSelection ? 1 : 0;
  });
  view.querySelector('#CategorySummary').innerText =
    `${shown} of ${total} categories shown, ${selected} with selected channels.`;
};

const renderSearch = (view, Xtream, data, items, query) => {
  const body = view.querySelector('#SearchContent');
  const status = view.querySelector('#SearchStatus');
  body.innerHTML = '';
  status.innerText = items.length === 0
    ? `No channels match "${query}".`
    : `${items.length}${items.length >= 300 ? '+' : ''} channels match "${query}".`;

  items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.dataset.searchId = item.Id;
    tr.dataset.searchCategory = item.CategoryId ?? '';

    let td = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.CategoryId != null && isSelected(data, item.CategoryId, item.Id);
    checkbox.disabled = item.CategoryId == null;
    checkbox.onchange = async () => {
      checkbox.disabled = true;
      try {
        await setChannel(Xtream, data, item.CategoryId, item.Id, checkbox.checked);
        refreshCategoryRow(view, data, item.CategoryId);
        applyCategoryFilter(view, data);
      } catch (error) {
        console.error('Failed to update channel selection:', error);
        checkbox.checked = !checkbox.checked;
      } finally {
        checkbox.disabled = false;
      }
    };
    td.appendChild(checkbox);
    tr.appendChild(td);

    td = document.createElement('td');
    td.innerText = item.Name;
    tr.appendChild(td);

    td = document.createElement('td');
    td.classList.add('xtream-search-category');
    td.innerText = categoryRow(view, item.CategoryId)?.children[1].innerText ?? '';
    tr.appendChild(td);

    body.appendChild(tr);
  });
};

const setupFilters = (view, Xtream, data) => {
  const search = view.querySelector('#ChannelSearch');
  const results = view.querySelector('#SearchResults');
  const categoryFilter = view.querySelector('#CategoryFilter');
  const onlySelected = view.querySelector('#OnlySelected');
  let timer;
  let latest = 0;

  search.oninput = () => {
    clearTimeout(timer);
    const query = search.value.trim();
    if (query.length < 2) {
      results.hidden = true;
      return;
    }

    timer = setTimeout(() => {
      const request = ++latest;
      results.hidden = false;
      view.querySelector('#SearchStatus').innerText = 'Searching...';
      Xtream.fetchJson(`Xtream/LiveSearch?query=${encodeURIComponent(query)}`)
        .then((items) => {
          if (request === latest) {
            renderSearch(view, Xtream, data, items, query);
          }
        })
        .catch((error) => {
          console.error('Channel search failed:', error);
          if (request === latest) {
            view.querySelector('#SearchStatus').innerText = 'Search failed, check the provider connection.';
          }
        });
    }, 350);
  };

  categoryFilter.oninput = () => applyCategoryFilter(view, data);
  onlySelected.onchange = () => applyCategoryFilter(view, data);

  // Category checkboxes change the data too; keep the summary and search results in step.
  view.querySelector('#LiveContent').onchange = () => {
    applyCategoryFilter(view, data);
    view.querySelectorAll('#SearchContent > tr[data-search-id]').forEach((row) => {
      if (row.dataset.searchCategory !== '') {
        row.querySelector('input').checked = isSelected(data, row.dataset.searchCategory, Number(row.dataset.searchId));
      }
    });
  };

  search.value = '';
  categoryFilter.value = '';
  onlySelected.checked = false;
  results.hidden = true;
  applyCategoryFilter(view, data);
};

export default function (view) {
  view.addEventListener("viewshow", () => import(
    ApiClient.getUrl("web/ConfigurationPage", {
      name: "Xtream.js",
    })
  ).then((Xtream) => Xtream.default
  ).then((Xtream) => {
    const pluginId = Xtream.pluginConfig.UniqueId;
    Xtream.setTabs(1);

    const getConfig = ApiClient.getPluginConfiguration(pluginId);
    const visible = view.querySelector("#Visible");
    getConfig.then((config) => visible.checked = config.IsCatchupVisible);
    const table = view.querySelector('#LiveContent');
    Xtream.populateCategoriesTable(
      table,
      () => getConfig.then((config) => config.LiveTv),
      () => Xtream.fetchJson('Xtream/LiveCategories'),
      (categoryId) => Xtream.fetchJson(`Xtream/LiveCategories/${categoryId}`),
    ).then((data) => {
      setupFilters(view, Xtream, data);
      // viewshow fires on every visit; assigning replaces the previous handler.
      view.querySelector('#XtreamLiveForm').onsubmit = (e) => {
        Dashboard.showLoadingMsg();

        ApiClient.getPluginConfiguration(pluginId).then((config) => {
          config.IsCatchupVisible = visible.checked;
          config.LiveTv = data;
          ApiClient.updatePluginConfiguration(pluginId, config).then((result) => {
            Dashboard.processPluginConfigurationUpdateResult(result);
          });
        });

        e.preventDefault();
        return false;
      };
    }).catch((error) => {
      console.error('Failed to load Live TV categories:', error);
      Dashboard.hideLoadingMsg();
      table.innerHTML = '';
      const errorRow = document.createElement('tr');
      const errorCell = document.createElement('td');
      errorCell.colSpan = 3;
      errorCell.style.color = '#ff6b6b';
      errorCell.style.padding = '16px';
      errorCell.innerHTML = 'Failed to load categories. Please check:<br>' +
        '1. Xtream credentials are configured (Credentials tab)<br>' +
        '2. Xtream server is accessible<br>' +
        '3. Browser console for detailed errors';
      errorRow.appendChild(errorCell);
      table.appendChild(errorRow);
    });
  }));
}