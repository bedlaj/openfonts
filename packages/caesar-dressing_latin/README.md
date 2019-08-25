
# caesar-dressing_latin

The CSS and web font files to easily self-host “Caesar Dressing” with subset "latin".

## Install

`npm install --save @openfonts/caesar-dressing_latin`

## Use

Typefaces assume you’re using webpack to process CSS and files. Each typeface
package includes all necessary font files (woff2, woff) and a CSS file with
font-face declarations pointing at these files.

You will need to have webpack setup to load css and font files. Many tools built
with Webpack will work out of the box with Typefaces such as [Gatsby](https://github.com/gatsbyjs/gatsby)
and [Create React App](https://github.com/facebookincubator/create-react-app).

To use, simply require the package in your project’s entry file e.g.

```javascript
// Load Caesar Dressing typeface
require('@openfonts/caesar-dressing_latin')
```
