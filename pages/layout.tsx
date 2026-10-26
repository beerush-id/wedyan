import { page } from '@airlib/react';
import rootRoute from './route.js';

export default page(rootRoute).render(({ children }) => <main>{children}</main>);
