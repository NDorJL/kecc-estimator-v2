import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Simple embeddable lead capture form HTML
const FORM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Request a Quote</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; padding: 24px; }
  .form-wrap { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 16px; }
  label { display: block; font-size: 0.75rem; font-weight: 600; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  input, select, textarea { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.9rem; outline: none; transition: border-color 0.15s; }
  input:focus, select:focus, textarea:focus { border-color: #3b82f6; }
  .field { margin-bottom: 14px; }
  button { width: 100%; padding: 12px; background: #16a34a; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 4px; }
  button:hover { background: #15803d; }
  .success { display: none; padding: 16px; background: #dcfce7; border-radius: 8px; color: #166534; font-weight: 500; text-align: center; margin-top: 16px; }
  .error-msg { color: #dc2626; font-size: 0.8rem; margin-top: 6px; display: none; }
</style>
</head>
<body>
<div class="form-wrap">
  <h2>Request a Free Quote</h2>
  <form id="leadForm">
    <div class="field">
      <label for="name">Full Name *</label>
      <input type="text" id="name" name="name" placeholder="John Smith" required />
    </div>
    <div class="field">
      <label for="phone">Phone Number *</label>
      <input type="tel" id="phone" name="phone" placeholder="(865) 555-0100" required />
    </div>
    <div class="field">
      <label for="email">Email Address</label>
      <input type="email" id="email" name="email" placeholder="john@example.com" />
    </div>
    <div class="field">
      <label for="address">Service Address</label>
      <input type="text" id="address" name="address" placeholder="123 Main St, Knoxville, TN" />
    </div>
    <div class="field">
      <label for="service">Service Interest</label>
      <select id="service" name="service">
        <option value="">Select a service…</option>
        <option value="Lawn Care">Lawn Care / Mowing</option>
        <option value="Landscaping">Landscaping</option>
        <option value="Mulching">Mulching</option>
        <option value="Leaf Removal">Leaf Removal</option>
        <option value="Snow Removal">Snow Removal</option>
        <option value="Hardscaping">Hardscaping</option>
        <option value="Other">Other</option>
      </select>
    </div>
    <div class="field">
      <label for="notes">Additional Notes</label>
      <textarea id="notes" name="notes" rows="3" placeholder="Tell us more about your property or needs…"></textarea>
    </div>
    <button type="submit" id="submitBtn">Request My Free Quote</button>
    <p class="error-msg" id="errorMsg">Something went wrong. Please try again.</p>
  </form>
  <div class="success" id="successMsg">
    Thanks! We'll be in touch shortly to schedule your free estimate.
  </div>
</div>
<script>
document.getElementById('leadForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const errMsg = document.getElementById('errorMsg');
  btn.textContent = 'Sending…';
  btn.disabled = true;
  errMsg.style.display = 'none';
  const payload = {
    name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    email: document.getElementById('email').value || null,
    address: document.getElementById('address').value || null,
    serviceInterest: document.getElementById('service').value || null,
    notes: document.getElementById('notes').value || null,
  };
  try {
    const res = await fetch('/.netlify/functions/lead-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Server error');
    document.getElementById('leadForm').style.display = 'none';
    document.getElementById('successMsg').style.display = 'block';
  } catch {
    btn.textContent = 'Request My Free Quote';
    btn.disabled = false;
    errMsg.style.display = 'block';
  }
});
</script>
</body>
</html>`

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  // Serve embeddable form
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' },
      body: FORM_HTML,
    }
  }

  // Handle form submission
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body ?? '{}')
      const { name, phone, email, address, serviceInterest, notes } = body

      if (!name || !phone) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Name and phone are required' }),
        }
      }

      // Create contact
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          name,
          phone: phone ?? null,
          email: email ?? null,
          source: 'website',
          type: 'residential',
        })
        .select()
        .single()

      if (contactError) throw contactError

      // Add property if address provided
      if (address) {
        await supabase.from('properties').insert({
          contact_id: contact.id,
          address,
          type: 'residential',
        })
      }

      // Create lead
      await supabase.from('leads').insert({
        contact_id: contact.id,
        stage: 'new',
        source: 'website',
        service_interest: serviceInterest ?? null,
        notes: notes ?? null,
      })

      // Log activity
      await supabase.from('activities').insert({
        contact_id: contact.id,
        type: 'note',
        summary: `Lead submitted via website form${serviceInterest ? ` — ${serviceInterest}` : ''}`,
      })

      return {
        statusCode: 201,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, contactId: contact.id }),
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: message }),
      }
    }
  }

  return {
    statusCode: 405,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method not allowed' }),
  }
}
