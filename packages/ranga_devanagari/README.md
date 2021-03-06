
# ranga_devanagari

The CSS and web font files to easily self-host “Ranga” with subset "devanagari".

## Install

`npm install --save @openfonts/ranga_devanagari`

## Use

Typefaces assume you’re using webpack to process CSS and files. Each typeface
package includes all necessary font files (woff2, woff) and a CSS file with
font-face declarations pointing at these files.

You will need to have webpack setup to load css and font files. Many tools built
with Webpack will work out of the box with Typefaces such as [Gatsby](https://github.com/gatsbyjs/gatsby)
and [Create React App](https://github.com/facebookincubator/create-react-app).

To use, simply require the package in your project’s entry file e.g.

```javascript
// Load Ranga typeface
require('@openfonts/ranga_devanagari')
```

Usage in SCSS:
```scss
@import "~@openfonts/ranga_devanagari/index.css";
```
