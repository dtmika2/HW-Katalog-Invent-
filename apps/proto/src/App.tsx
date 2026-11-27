import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Empty } from './components/ui';
import { cs } from './i18n/cs';
import { BookingEditor } from './routes/BookingEditor';
import { Bookings, NewBooking, Notifications } from './routes/Bookings';
import { Catalog } from './routes/CatalogEditor';
import { Clients } from './routes/Clients';
import { Dashboard } from './routes/Dashboard';
import { EventCalendar } from './routes/EventCalendar';
import { CaseTypeDetail, ItemDetail } from './routes/ItemDetail';
import { Loans } from './routes/Loans';
import { NewItem } from './routes/NewItem';
import { Packing } from './routes/Packing';
import { ProfileRoute } from './routes/Profile';
import { Team } from './routes/Team';
import { Shipping } from './routes/Shipping';
import { Service } from './routes/Service';
import { Vratka } from './routes/Vratka';
import { WarehouseDashboard } from './routes/Warehouse';
import { useProto } from './store';

function Later() {
  return <Empty>{cs.common.later}</Empty>;
}

export function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/bookings/new" element={<NewBooking />} />
        <Route path="/bookings/:id" element={<BookingEditor />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/calendar" element={<EventCalendar />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/items/new" element={<NewItem />} />
        <Route path="/items/:id" element={<ItemDetail />} />
        <Route path="/case-types/:id" element={<CaseTypeDetail />} />
        <Route path="/packing/:id" element={<Packing />} />
        <Route path="/shipping/:id" element={<Shipping />} />
        <Route path="/vratka/:id" element={<Vratka />} />
        <Route path="/loans" element={<Loans />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/service" element={<Service />} />
        <Route path="/warehouse" element={<WarehouseDashboard />} />
        <Route path="/profil" element={<ProfileRoute />} />
        <Route path="/profil/:userId" element={<ProfileRoute />} />
        <Route path="/tym" element={<Team />} />
        <Route path="*" element={<Later />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  const ready = useProto((p) => p.state !== null);
  const init = useProto((p) => p.init);
  useEffect(() => {
    if (ready) return;
    // Let the loading screen paint before generating demo data.
    const t = setTimeout(init, 20);
    return () => clearTimeout(t);
  }, [ready, init]);
  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div className="text-center">
          <p className="font-cond text-3xl font-bold">{cs.app.title}</p>
          <p className="text-sm text-muted">{cs.app.loading}</p>
        </div>
      </main>
    );
  }
  return <AppRoutes />;
}
