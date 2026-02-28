const loginForm = document.getElementById('loginForm');
const feedbackForm = document.getElementById('feedbackForm');
const feedbackList = document.getElementById('feedbackList');
const loginStatus = document.getElementById('loginStatus');
const feedbackStatus = document.getElementById('feedbackStatus');
const refreshBtn = document.getElementById('refreshBtn');

let loggedInUser = '';

async function loadFeedback() {
  feedbackList.innerHTML = '<li>Loading feedback...</li>';

  try {
    const response = await fetch('/api/feedback');
    if (!response.ok) {
      throw new Error('Failed to fetch feedback.');
    }

    const feedbackItems = await response.json();

    if (feedbackItems.length === 0) {
      feedbackList.innerHTML = '<li>No feedback yet.</li>';
      return;
    }

    feedbackList.innerHTML = feedbackItems
      .map(
        (item) => `
          <li>
            <strong>${item.username}</strong> (${item.rating}/5)
            <p>${item.message}</p>
            <p class="meta">${new Date(item.createdAt).toLocaleString()}</p>
          </li>
        `
      )
      .join('');
  } catch (error) {
    feedbackList.innerHTML = `<li>${error.message}</li>`;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const payload = {
    username: formData.get('username').trim(),
    password: formData.get('password').trim()
  };

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

    loggedInUser = data.user.username;
    loginStatus.textContent = `Logged in as ${loggedInUser}.`;
    feedbackStatus.textContent = '';
    feedbackForm.reset();
  } catch (error) {
    loginStatus.textContent = error.message;
  }
});

feedbackForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!loggedInUser) {
    feedbackStatus.textContent = 'Please login first.';
    return;
  }

  const formData = new FormData(feedbackForm);
  const payload = {
    username: loggedInUser,
    message: formData.get('message').trim(),
    rating: Number(formData.get('rating'))
  };

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Unable to submit feedback.');
    }

    feedbackStatus.textContent = 'Feedback submitted successfully.';
    feedbackForm.reset();
    await loadFeedback();
  } catch (error) {
    feedbackStatus.textContent = error.message;
  }
});

refreshBtn.addEventListener('click', loadFeedback);

loadFeedback();
