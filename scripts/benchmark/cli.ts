/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { main } from './main';

main(process.argv.slice(2)).then((code) => {
  process.exit(code);
});
