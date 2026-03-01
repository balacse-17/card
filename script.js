const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');
const profileForm = document.getElementById('profileForm');
const feedbackForm = document.getElementById('feedbackForm');
const refreshBtn = document.getElementById('refreshBtn');
const submissionList = document.getElementById('submissionList');
const ratingRange = document.getElementById('ratingRange');
const ratingSelected = document.getElementById('ratingSelected');

const registerStatus = document.getElementById('registerStatus');
const loginStatus = document.getElementById('loginStatus');
const profileStatus = document.getElementById('profileStatus');
const feedbackStatus = document.getElementById('feedbackStatus');
const totalRecords = document.getElementById('totalRecords');
const totalProfiles = document.getElementById('totalProfiles');
const totalFeedback = document.getElementById('totalFeedback');

let authToken = '';
let loggedInUser = '';

function setAuth(token, username) {
  authToken = token;
  loggedInUser = username;
}

ratingRange.addEventListener('input', () => {
  ratingSelected.textContent = ratingRange.value;
});

async function updateSystemMetrics() {
  try {
    const response = await fetch('/api/system');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Could not load system info.');
    }

    const { metrics } = data;
    totalRecords.textContent = metrics.totalRecords;
    totalProfiles.textContent = metrics.profiles;
    totalFeedback.textContent = metrics.feedback;
  } catch {
    totalRecords.textContent = '-';
    totalProfiles.textContent = '-';
    totalFeedback.textContent = '-';
  }
}

async function loadSubmissions() {
  if (!authToken) {
    submissionList.innerHTML = '<li>Login required to load submissions.</li>';
    return;
  }

  submissionList.innerHTML = '<li>Loading submissions...</li>';

  try {
    const response = await fetch('/api/submissions', {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Unable to load submissions.');
    }

    if (data.length === 0) {
      submissionList.innerHTML = '<li>No submissions yet.</li>';
      return;
    }

    submissionList.innerHTML = data
      .map(
        (item) => `
          <li>
            <strong>${item.type.toUpperCase()} · ${item.title}</strong>
            <p>${item.details}</p>
            <p class="muted">By ${item.username} · ${new Date(item.createdAt).toLocaleString()}</p>
          </li>
        `
      )
      .join('');
  } catch (error) {
    submissionList.innerHTML = `<li>${error.message}</li>`;
  }
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(registerForm).entries());

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Registration failed.');
    }

    registerStatus.textContent = `Registered ${data.username}.`; 
    registerForm.reset();
  } catch (error) {
    registerStatus.textContent = error.message;
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(loginForm).entries());

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Login failed.');
    }

    setAuth(data.token, data.user.username);
    loginStatus.textContent = `Logged in as ${loggedInUser}.`;
    await Promise.all([loadSubmissions(), updateSystemMetrics()]);
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  if (!authToken) {
    loginStatus.textContent = 'You are not logged in.';
    return;
  }

  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Logout failed.');
    }

    setAuth('', '');
    submissionList.innerHTML = '<li>Login required to load submissions.</li>';
    loginStatus.textContent = data.message;
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!authToken) {
    profileStatus.textContent = 'Please login first.';
    return;
  }

  const formData = new FormData(profileForm);
  const payload = {
    fullName: formData.get('fullName').trim(),
    email: formData.get('email').trim(),
    age: Number(formData.get('age')) || null,
    favoriteColor: formData.get('favoriteColor'),
    bio: formData.get('bio').trim(),
    newsletter: formData.get('newsletter') === 'on'
  };

  try {
    const response = await fetch('/api/profiles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Profile submit failed.');
    }

    profileStatus.textContent = `Profile saved for ${data.fullName}.`;
    profileForm.reset();
    await Promise.all([loadSubmissions(), updateSystemMetrics()]);
  } catch (error) {
    profileStatus.textContent = error.message;
  }
});

feedbackForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!authToken) {
    feedbackStatus.textContent = 'Please login first.';
    return;
  }

  const formData = new FormData(feedbackForm);
  const payload = {
    topic: formData.get('topic'),
    message: formData.get('message').trim(),
    sentiment: formData.get('sentiment'),
    contactTime: formData.get('contactTime'),
    rating: Number(ratingRange.value)
  };

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Feedback submit failed.');
    }

    feedbackStatus.textContent = `Feedback submitted with rating ${data.rating}.`;
    feedbackForm.reset();
    ratingRange.value = '3';
    ratingSelected.textContent = '3';
    await Promise.all([loadSubmissions(), updateSystemMetrics()]);
  } catch (error) {
    feedbackStatus.textContent = error.message;
  }
});

refreshBtn.addEventListener('click', async () => {
  await Promise.all([loadSubmissions(), updateSystemMetrics()]);
});

updateSystemMetrics();
loadSubmissions();
