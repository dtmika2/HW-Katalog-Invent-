import { Route, Routes } from 'react-router-dom';
import { cs } from './i18n/cs';

function Home() {
  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">{cs.app.title}</h1>
      <p className="text-slate-600">{cs.app.tagline}</p>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
