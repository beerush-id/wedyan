import { Aria, JSXTranslator } from '@airlib/aria';
import { type AppEntry, UIRouter } from '@airlib/react';
// The sample documents, on the drive until the backend serves one.
import '@/documents/index.js';
import RootLayout from '@/pages/layout.js';
import router from './router.js';

Aria.translate(JSXTranslator);

export default (({ url }) => <UIRouter router={router} root={RootLayout} url={url} />) satisfies AppEntry;
