import { Aria, JSXTranslator } from '@airlib/aria';
import { type AppEntry, UIRouter } from '@airlib/react';
import { configure } from '@irpclib/r2-file';
// The sample documents, on the drive until the backend serves one.
import '@/documents/index.js';
import RootLayout from '@/pages/layout.js';
import { FILES_ENDPOINT } from './api.js';
import router from './router.js';

Aria.translate(JSXTranslator);
configure({ endpoint: FILES_ENDPOINT });

export default (({ url }) => <UIRouter router={router} root={RootLayout} url={url} />) satisfies AppEntry;
