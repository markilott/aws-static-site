import moment = require('moment');

const apiBaseUrl = process.env.API_DOMAIN_BASE;

// Register page
const registerForm = document.getElementById('registerForm');
const registerNameInput = document.getElementById('registerName') as HTMLInputElement;
const registerEmailInput = document.getElementById('registerEmail') as HTMLInputElement;
const registerDateInput = document.getElementById('registerDate') as HTMLInputElement;
const registerBlock = document.getElementById('registerBlock');

// Manage page
const queryForm = document.getElementById('queryForm');
const queryReferenceInput = document.getElementById('queryReference') as HTMLInputElement;
const queryEmailInput = document.getElementById('queryEmail') as HTMLInputElement;
const queryBlock = document.getElementById('queryBlock');
const queryDetail = document.getElementById('queryDetail');
const invalidQueryAlertBlock = document.getElementById('invalidQueryAlert');
const invalidQueryMsgSpan = document.getElementById('invalidQueryMsg');

const queryResultBlock = document.getElementById('queryResultBlock');
const updateResultBlock = document.getElementById('updateResultBlock');
const updateButton = document.getElementById('updateButton');

const updateForm = document.getElementById('updateForm');
const updateReferenceInput = document.getElementById('updateReference') as HTMLInputElement;
const updateEmailInput = document.getElementById('updateEmail') as HTMLInputElement;
const updateDateInput = document.getElementById('updateDate') as HTMLInputElement;
const updateBlock = document.getElementById('updateBlock');
const updateDetail = document.getElementById('updateDetail');
const updateReferenceSpan = document.getElementById('updateReferenceSpan');
const updateDateSpan = document.getElementById('updateDateSpan');
const invalidUpdateAlertBlock = document.getElementById('invalidUpdateAlert');
const invalidUpdateMsgSpan = document.getElementById('invalidUpdateMsg');

// Common
const resultBlock = document.getElementById('resultBlock');
const successDetail = document.getElementById('successDetail');
const errorDetail = document.getElementById('errorDetail');

const nameSpan = document.getElementById('nameSpan');
const emailSpan = document.getElementById('emailSpan');
const referenceSpan = document.getElementById('referenceSpan');
const dateSpan = document.getElementById('dateSpan');
const msgErrorSpan = document.getElementById('msgErrorSpan');

const postDefaultParams: RequestInit = {
    mode: 'cors',
    headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    },
};

type PostProps = {
    url: string,
    /**
     * Method
     * @default 'POST'
     */
    method?: string,
    formData: FormData,
};

type RegisterResponse = {
    success: boolean,
    requestId: string,
    errorMessage?: string,
    data: {
        reference: string,
        registerDate: string,
        email: string,
        name: string,
    } | null,
};

/** Post form data to API */
async function postFormDataAsJson(params: PostProps) {
    const { url, formData, method = 'POST' } = params;
    const plainFormData = Object.fromEntries(formData.entries());
    const formDataJsonStr = JSON.stringify(plainFormData);

    const response = await fetch(url, {
        body: (method === 'POST' || method === 'PATCH') ? formDataJsonStr : undefined,
        method,
        ...postDefaultParams,
    });

    const data = await response.json() as RegisterResponse;
    if (response.ok) {
        return data;
    }
    return {
        success: false,
        requestId: data.requestId || 'Unknown',
        errorMessage: data.errorMessage || 'Internal Error',
        data: null,
    };
}

// Register Form ========================================================

function clearRegisterForm() {
    registerNameInput.value = '';
    registerEmailInput.value = '';
    registerDateInput.value = '';
}

/** Post Register form to API and format result */
async function registerFormHandler(event: SubmitEvent) {
    event.preventDefault();

    const form = event.currentTarget as HTMLFormElement;
    const url = `${apiBaseUrl}/register`;

    try {
        const formData = new FormData(form);
        const result = await postFormDataAsJson({ url, formData });
        clearRegisterForm();

        if (result.success) {
            registerBlock.classList.add('d-none');
            resultBlock.classList.remove('d-none');

            successDetail.classList.remove('d-none');
            errorDetail.classList.add('d-none');

            const {
                name, email, reference, registerDate,
            } = result.data;
            window.sessionStorage.setItem('reference', reference);
            window.sessionStorage.setItem('email', email);

            nameSpan.textContent = name;
            emailSpan.textContent = email;
            referenceSpan.textContent = reference;
            dateSpan.textContent = registerDate;
        } else {
            registerBlock.classList.add('d-none');
            resultBlock.classList.remove('d-none');

            successDetail.classList.add('d-none');
            errorDetail.classList.remove('d-none');

            const { errorMessage } = result;

            msgErrorSpan.textContent = errorMessage;
        }
    } catch (err) {
        console.error(err);
    }
}
// eslint-disable-next-line @typescript-eslint/no-misused-promises
if (registerForm) { registerForm.addEventListener('submit', registerFormHandler); }

// Query Form ========================================================

function clearQueryForm() {
    queryReferenceInput.value = '';
    queryEmailInput.value = '';
    invalidQueryAlertBlock.classList.add('d-none');
}

function showQueryAlert(msg: string, isError?: boolean) {
    invalidQueryAlertBlock.classList.remove('d-none');
    const alertType = isError ? 'alert-warning' : 'alert-error';
    const notType = isError ? 'alert-error' : 'alert-warning';
    invalidQueryAlertBlock.classList.remove(notType);
    invalidQueryAlertBlock.classList.add(alertType);
    invalidQueryMsgSpan.textContent = msg;
}

/** Post Query form to API and format result */
async function queryFormHandler(event: SubmitEvent) {
    event.preventDefault();

    try {
        const form = event.currentTarget as HTMLFormElement;
        const formData = new FormData(form);
        const plainFormData = Object.fromEntries(formData.entries());
        invalidQueryAlertBlock.classList.add('d-none');

        // Use referenceId if provided
        const { email: emailInput, reference: referenceInput } = plainFormData;
        if (!emailInput && !referenceInput) {
            showQueryAlert('Email or Reference is required');
            return;
        }

        const queryString = (referenceInput) ? `reference=${referenceInput.toString()}` : `email=${emailInput.toString()}`;

        const url = `${apiBaseUrl}/register?${queryString}`;

        const result = await postFormDataAsJson({ url, method: 'GET', formData });
        clearQueryForm();

        if (result.success) {
            queryBlock.classList.add('d-none');
            queryDetail.classList.remove('d-none');

            updateResultBlock.classList.add('d-none');
            queryResultBlock.classList.remove('d-none');

            resultBlock.classList.remove('d-none');
            updateDetail.classList.add('d-none');
            errorDetail.classList.add('d-none');

            const {
                name, email, reference, registerDate,
            } = result.data;
            window.sessionStorage.setItem('reference', reference);
            window.sessionStorage.setItem('email', email);

            nameSpan.textContent = name;
            emailSpan.textContent = email;
            referenceSpan.textContent = reference;
            dateSpan.textContent = registerDate;
        } else {
            const msg = result.errorMessage;
            if (!msg) { throw new Error('Invalid response'); }
            showQueryAlert(msg);
        }
    } catch (err) {
        showQueryAlert('Sorry we encountered an error, please try again', true);
    }
}
// eslint-disable-next-line @typescript-eslint/no-misused-promises
if (queryForm) { queryForm.addEventListener('submit', queryFormHandler); }

/** Update Button Handler */
if (updateButton) {
    updateButton.onclick = () => {
        queryBlock.classList.add('d-none');
        queryDetail.classList.add('d-none');
        resultBlock.classList.add('d-none');
        updateBlock.classList.remove('d-none');
        const currentReference = window.sessionStorage.getItem('reference');
        const currentEmail = window.sessionStorage.getItem('email');
        if (currentReference && currentEmail) {
            updateReferenceInput.value = currentReference;
            updateEmailInput.value = currentEmail;
        }
    };
}

// Update Form ========================================================

function clearUpdateForm() {
    updateReferenceInput.value = '';
    updateEmailInput.value = '';
    updateDateInput.value = '';
}

function showUpdateAlert(msg: string, isError?: boolean) {
    invalidUpdateAlertBlock.classList.remove('d-none');
    const alertType = isError ? 'alert-warning' : 'alert-error';
    const notType = isError ? 'alert-error' : 'alert-warning';
    invalidUpdateAlertBlock.classList.remove(notType);
    invalidUpdateAlertBlock.classList.add(alertType);
    invalidUpdateMsgSpan.textContent = msg;
}

/** Post Update form to API and format result */
async function updateFormHandler(event: SubmitEvent) {
    event.preventDefault();
    const submitButton = event.submitter;

    const form = event.currentTarget as HTMLFormElement;

    try {
        const formData = new FormData(form);
        const plainFormData = Object.fromEntries(formData.entries());
        invalidUpdateAlertBlock.classList.add('d-none');

        // Use referenceId if provided
        const { email: emailInput, registerDate: registerDateUpdate } = plainFormData;
        if (!emailInput) {
            showUpdateAlert('Email is required');
            return;
        }

        const isDelete = (submitButton.id === 'deleteButton');
        const url = (isDelete) ? `${apiBaseUrl}/register?email=${emailInput.toString()}` : `${apiBaseUrl}/register`;
        const method = (isDelete) ? 'DELETE' : 'PATCH';

        if (!isDelete && !registerDateUpdate) {
            showUpdateAlert('Please select a new date');
            return;
        }

        const result = await postFormDataAsJson({ url, method, formData });

        if (result.success) {
            updateBlock.classList.add('d-none');
            resultBlock.classList.remove('d-none');

            updateResultBlock.classList.remove('d-none');
            queryResultBlock.classList.add('d-none');

            updateDetail.classList.remove('d-none');
            errorDetail.classList.add('d-none');

            const {
                reference, registerDate,
            } = result.data;

            updateReferenceSpan.textContent = reference || 'Deleted';
            updateDateSpan.textContent = registerDate || 'Deleted';
            clearUpdateForm();
        } else {
            const msg = result.errorMessage;
            if (!msg) { throw new Error('Invalid response'); }
            showUpdateAlert(msg);
        }
    } catch (err) {
        showUpdateAlert('Sorry we encountered an error, please try again', true);
    }
}
// eslint-disable-next-line @typescript-eslint/no-misused-promises
if (updateForm) { updateForm.addEventListener('submit', updateFormHandler); }

/**
 * Setup page on load
 */
window.onload = function loadPage() {
    try {
        if (registerDateInput) {
            const min = moment().add(1, 'd').format('YYYY-MM-DD');
            const max = moment().add(30, 'd').format('YYYY-MM-DD');
            registerDateInput.min = min;
            registerDateInput.max = max;
        }
        return true;
    } catch (err) {
        return false;
    }
};
