import 'dotenv/config';
import { app } from './app.js';

const PORT = Number(process.env.PORT) || 4001;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[quotation-service] API + admin UI démarrés sur http://localhost:${PORT}`);
  console.log(`[quotation-service] Page d'administration : http://localhost:${PORT}/admin/login.html`);
});
