const express = require('express');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const Rollbar = require('rollbar');
const { I18n } = require('i18n');
const { Feed }   = require('feed');

let rollbar;
if (process.env.ROLLBAR_ACCESS_TOKEN) {
  console.log('Rollbar enabled');
  rollbar = new Rollbar({
    accessToken: process.env.ROLLBAR_ACCESS_TOKEN,
    captureUncaught: true,
    captureUnhandledRejections: true
  });
} else {
  console.log('Rollbar disabled');
}

const i18n = new I18n({
  locales: ['en', 'zh-tw'],
  directory: 'locales',
  missingKeyFn: function (locale, value) {
    if (value.startsWith('Country:') || value.startsWith('City:') || value.startsWith('Area:') || value.startsWith('Station:')) {
      return value.split(':').slice(1).join(':').slice(1);
    } else {
      return value;
    }
  },
});

const data = require('./data');
const submit = require('./submit');

const app = express();
const port = 3000;

app.set('views', 'views');
app.set('view engine', 'pug');
app.set('strict routing', true);

const DEBUG = process.env.NODE_ENV !== 'production';

// Disable redirect, otherwise the middleware auto creates redirects for directories
// E.g. /taipei -> /taipei/ which conflicts with the city urls!
app.use(express.static('public', { redirect: false, maxAge: DEBUG ? 0 : '1y' }));
app.use(express.static('images', { redirect: false, maxAge: DEBUG ? 0 : '1y' }));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(morgan('dev'));

app.locals.site = {
  title: 'Cafe and Cowork',
  summary: 'Find Places to Work From',
  description: 'A curated collection of cafes and coworking spaces around the world. Find the best places with power outlets and fast WiFi to work or study from.',
  url: DEBUG ? 'http://localhost:3000' : 'https://cafeandcowork.com',
  github: 'https://github.com/pqvst/cafeandcowork',
  instagram: 'https://instagram.com/cafeandcowork',
  mailto: 'mailto:hello@cafeandcowork.com',
};

app.locals.DEBUG = DEBUG;
app.locals.pretty = DEBUG;
app.locals.v = Date.now();
app.locals.marked = require('marked');

Object.assign(app.locals, require('./view-helpers'));
Object.assign(app.locals, data.load());

function redirectWithTrailingSlash(req, res) {
  res.redirect(301, req.path + '/' + req.url.slice(req.path.length));
}

app.use(i18n.init);

for (const locale of i18n.getLocales()) {
  const prefix = locale == 'en' ? '' : `/${locale}`;

  app.use(`${prefix}/`, (req, res, next) => {
    req.setLocale(locale);

    res.locals.prefix = prefix;

    res.locals.site = Object.assign({}, app.locals.site, {
      title: res.__(app.locals.site.title),
      summary: res.__(app.locals.site.summary),
      description: res.__(app.locals.site.description),
    });
    
    next();
  });

  if (prefix) {
    app.get(`${prefix}`, redirectWithTrailingSlash);
  }
  app.get(`${prefix}/`, (req, res) => {
    res.render('index', { url: '/' });
  });

  app.get(`${prefix}/about`, redirectWithTrailingSlash);
  app.get(`${prefix}/about/`, (req, res) => {
    res.render('about', { url: '/about/' });
  });

  for (const city of app.locals.cities) {    
    const cityDescription = data.getCityDescription(i18n, locale, city);

    app.get(`${prefix}/${city.id}`, redirectWithTrailingSlash);
    app.get(`${prefix}/${city.id}/`, (req, res) => {
      res.render('city', {
        title: res.__(`City: ${city.name}`),
        description: cityDescription,
        url: city.url,
        city
      });
    });

    for (const redirect of city.redirects) {
      app.get(`${prefix}/${city.id}/${encodeURI(redirect.id)}`, redirectWithTrailingSlash);
      app.get(`${prefix}/${city.id}/${encodeURI(redirect.id)}/`, (req, res) => {
        res.redirect(`${prefix}/${redirect.redirect}/`);
      });
    }

    for (const place of city.places) {
      const placeDescription = data.getPlaceDescription(i18n, locale, place);

      app.get(`${prefix}/${city.id}/${encodeURI(place.id)}`, redirectWithTrailingSlash);
      app.get(`${prefix}/${city.id}/${encodeURI(place.id)}/`, (req, res) => {
        res.render('place', {
          title: place.name,
          description: placeDescription,
          url: place.url,
          image: place.images && place.images.length > 0 ? place.images[0] : null,
          city,
          place
        });
      });
    }
  }  

}

const submissionLimiter = rateLimit({
  keyGenerator: () => 'all',
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit to 10 submissions per 5 minutes
});

app.get('/submit', redirectWithTrailingSlash);
app.get('/submit/', (req, res) => {
  res.redirect('/');
});

app.post('/submit/', submissionLimiter, async (req, res) => {
  try {
    await submit.submit(req.body);
    res.send('ok');
  } catch (err) {
    console.log(err);
    res.status(400).end();
  }
});

app.get('/feed.xml', (req, res) => {
  res.type('application/xml');

  const locale = req.locale;
  const site = app.locals.site;

  const feed = new Feed({
    title: site.title,
    description: site.description,
    id: site.url,
    link: site.url,
    language: locale,
    image: `${site.url}/share.png`,
    updated: new Date,
  });
  
  app.locals.recent.forEach(item => {
    const placeDescription = data.getPlaceDescription(i18n, locale, item);
    feed.addItem({
      title: item.name,
      id: `${site.url}${item.url}`,
      link: `${site.url}${item.url}`,
      description: placeDescription,
      content: placeDescription,
      date: new Date(item.updated || item.added),
      image: item.images ? `${site.url}${item.images[0]}` : null,
    });
  });
  res.send(feed.rss2());
  //res.render('feed', { recent: app.locals.recent, pretty: true });
});

if (DEBUG) {
  app.get('/rollbar', (req, res) => {
    throw new Error('Keep Rollbar Active');
  });
}

app.use((req, res) => {
  res.status(404).render('error');
});

if (rollbar) {
  app.use(rollbar.errorHandler());
}

app.listen(port);

process.on('SIGTERM', () => {
  process.exit();
});

