const _ = require(`lodash`)

exports.packageJson = _.template(
  `
{
  "name": "@openfonts/<%= typefaceId %>_<%= typefaceSubset %>",
  "version": "0.0.0",
  "description": "<%= typefaceName %> <%= typefaceSubset %> typeface",
  "main": "index.css",
  "keywords": [
    "typeface",
    "font",
    "font family",
    "google fonts",
    "<%= typefaceId %>",
    "<%= typefaceSubset %>"
  ],
  "author": "Jan Bednar <openfonts@janbednar.eu>",
  "license": "MIT",
  "repository": "https://github.com/bedlaj/openfonts/tree/master/packages/<%= typefaceId %>_<%= typefaceSubset %>"
}
`
)

exports.fontFace = _.template(
  `/* <%= typefaceId %>-<%= weight %><%= style %> - <%= typefaceSubset %> */
@font-face {
  font-family: '<%= typefaceName %>';
  font-style: <%= style %>;
  font-display: swap;
  font-weight: <%= weight %>;
  src:<% _.each(locals, function(localName) { %>
    local('<%= localName %>'),<% });
    %> 
    url('<%= woff2Path %>') format('woff2'), /* Chrome 26+, Opera 23+, Firefox 39+ */
    url('<%= woffPath %>') format('woff'); /* Chrome 6+, Firefox 3.6+, IE 9+, Safari 5.1+ */
}
`
)

exports.readme = _.template(
  `
# <%= typefaceId %>_<%= typefaceSubset %>

The CSS and web font files to easily self-host “<%= typefaceName %>” with subset "<%= typefaceSubset %>".

## Install

\`npm install --save @openfonts/<%= typefaceId %>_<%= typefaceSubset %>\`

## Use

Typefaces assume you’re using webpack to process CSS and files. Each typeface
package includes all necessary font files (woff2, woff) and a CSS file with
font-face declarations pointing at these files.

You will need to have webpack setup to load css and font files. Many tools built
with Webpack will work out of the box with Typefaces such as [Gatsby](https://github.com/gatsbyjs/gatsby)
and [Create React App](https://github.com/facebookincubator/create-react-app).

To use, simply require the package in your project’s entry file e.g.

\`\`\`javascript
// Load <%= typefaceName %> typeface
require('@openfonts/<%= typefaceId %>_<%= typefaceSubset %>')
\`\`\`
`
)
