(function () {

  const UPDATE_TIMEOUT = 150;
  const DEFAULT_FILTER = 'score: yes';

  function colorRamp(value) {
    if (value >= 4) return '#418395';
    if (value >= 3.5) return '#59ae9f';
    if (value >= 3) return '#2ecc71';
    if (value >= 2) return '#f39c12';
    if (value == 0) return '#aaaaaa';
    return '#e67e22';
  }

  function makeMarker(coordinates, place) {
    return new mapboxgl.Marker({ color: colorRamp(place.score), scale: 0.5 })
      .setLngLat(coordinates)
      .setPopup(makePopup(place));
  }
  
  function makePopup(place) {
    const html = `
      <div class="popup">
        <div class="title">
          <a target="_blank" href="${place.url}">${place.name} (${place.score.toFixed(1)})</a>
        </div>
        <div class="address">
          <a target="_blank" href="${place.google_maps}">${place.address || ''}</a>
        </div>
        <div class="hours">${place.hours}</div>
      </div>
    `;
    return new mapboxgl.Popup({ offset: 25 }).setHTML(html);
  }
  
  function initMap(center, zoom, callback) {
    mapboxgl.accessToken = 'pk.eyJ1IjoicHF2c3QiLCJhIjoiY2ptcTBnYnBjMTQ5bzNxbXB3YXk2NTdxMCJ9.siEO29S7-nsJbBiZ_jVhrg';
    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: center,
      zoom: zoom
    });
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true
      },
      trackUserLocation: true
    }));
    map.addControl(new mapboxgl.NavigationControl({
      showCompass: false
    }));
    map.on('load', function() {
      callback(map);
    });
    return map;
  }

  function initPlace(place) {
    initMap(place.coordinates, 14, (map) => {
      new mapboxgl.Marker({ color: colorRamp(place.score) })
        .setLngLat(place.coordinates)
        .setPopup(makePopup(place))
        .addTo(map);
    });
  };
  
  let tid;

  function updateMarkers(places, map, markers, filter = DEFAULT_FILTER) {
    const bounds = new mapboxgl.LngLatBounds;
    let count = 0;
    const arr = Array.from(places).reverse();
    for (const place of arr) {
      if (!place.closed) {
        if (markers[place.url]) {
          if (checkFilter(place, filter)) {
            bounds.extend(place.coordinates);
            markers[place.url].addTo(map);
            count++;
          } else {
            markers[place.url].remove();
          }
        }
      }
    }
    if (count) {
      map.fitBounds(bounds, { padding: 100, linear: true, maxZoom: 17 });
    }
  }

  function updateRows(places, rows, filter = DEFAULT_FILTER) {
    for (const place of places) {
      const include = checkFilter(place, filter);
      const tr = rows[place.url];
      tr.style.display = include ? '' : 'none';
    }
  }

  function checkFilter(place, filter) {
    if (!filter) {
      return true;
    } else {
      filter = filter.toLowerCase()
        .split("'").join('')
        .split("-").join('');
      return place.filter
        .toLowerCase()
        .split("'").join('')
        .split("-").join('')
        .includes(filter);
    }
  }

  function initCity(opts) {
    const markers = {};

    const { coordinates, places, table, input } = opts;
    const map = initMap(coordinates, 10, (map) => {
      for (const place of places) {
        const marker = makeMarker(place.coordinates, place);
        markers[place.url] = marker;
      }
      updateMarkers(places, map, markers);
    });

    const rows = {};
    for (const tr of document.querySelectorAll(`tr[data-url]`)) {
      rows[tr.getAttribute('data-url')] = tr;
    }

    makeSortableTable(table, input);
    updateRows(places, rows);

    input.addEventListener('input', function (evt) {
      const filter = evt.target.value.toLowerCase();
      clearTimeout(tid);
      tid = setTimeout(() => {
        updateMarkers(places, map, markers, filter);
        updateRows(places, rows, filter);
      }, filter ? UPDATE_TIMEOUT : 0);
    });
  };

  const COL_NAME = 1;
  const COL_AREA = 19;
  const COL_OPENS = 20;
  const COL_CLOSES = 21;

  function makeSortableTable(table) {
    // Inspired by: https://stackoverflow.com/questions/14267781/sorting-html-table-with-javascript

    table.querySelectorAll('th').forEach((th, idx) => {
      if (idx == COL_NAME || idx == COL_AREA || idx == COL_OPENS) {
        th.asc = false;
      } else {
        th.asc = true;
      }
      th.addEventListener('click', (() => {
        sort(th);
      }));
    });

    const getCellValue = (tr, idx, name, asc) => {
      const text = tr.children[idx] ? tr.children[idx].innerText || tr.children[idx].textContent || '' : '';
      if (idx == COL_OPENS || idx == COL_CLOSES) {
        if (text == '') {
          return asc ? Number.MAX_VALUE : Number.MIN_VALUE;
        }
        let number = Number(text.replace(':', ''));
        if (number < 600) {
          number += 2400;
        }
        return number;
      }
      return text;
    };

    const compareValues = (v1, v2) => {
      return v1 !== '' && v2 !== '' && !isNaN(v1) && !isNaN(v2) ? v1 - v2 : v1.toString().localeCompare(v2);
    };

    const comparer = (idx, name, asc) => {
      return (a, b) => {
        const aClosed = a.classList.contains('closed');
        const bClosed = b.classList.contains('closed');
        if (aClosed && !bClosed) {
          return 1;
        } else if (!aClosed && bClosed) {
          return -1;
        } else {
          return compareValues(getCellValue(asc ? a : b, idx, name, asc), getCellValue(asc ? b : a, idx, name, asc));
        }
      };
    };

    function sort(th) {
      th.asc = !th.asc;
      const tbody = table.querySelector('tbody');
      Array.from(tbody.querySelectorAll('tr'))
        .sort(comparer(Array.from(th.parentNode.children).indexOf(th), th.innerText, th.asc))
        .forEach(tr => tbody.appendChild(tr) );
    }
  }

  window.CafeAndCowork = window.CafeAndCowork || { Place: initPlace, City: initCity };

})();
