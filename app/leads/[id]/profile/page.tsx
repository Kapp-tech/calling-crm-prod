import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { LeadProfilePage } from '@/components/leads/lead-profile-page';

export default async function Page({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return <LeadProfilePage leadId={params.id} agentName={session.user?.name ?? 'Your Counsellor'} />;
}
