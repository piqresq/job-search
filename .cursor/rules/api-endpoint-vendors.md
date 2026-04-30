<!-- Regenerate from `api-endpoint-vendors.txt` via `python scripts/sync-api-endpoint-vendors-md.py` after pasting new vendor docs. -->

# RapidAPI vendor endpoint reference (full archive)

**Purpose:** Verbatim vendor / RapidAPI documentation for job-search integrations. **Nothing in the body below this preamble should be removed** when updating—only append or replace sections the user pastes.

## For agents (how to use)

1. **Search this file** (or the `.txt` original) for: parameter names, hosts (`linkedin-job-search-api.p.rapidapi.com`, `jsearch.p.rapidapi.com`), paths (`/active-jb-24h`, `/search`), enums, credits, error text, and JSON field names.
2. **Two main vendors** (see horizontal rules below):
   - **Fantastic Jobs — LinkedIn Job Search API** — from the top through just before the JSearch RapidAPI playground URL.
   - **JSearch (OpenWeb Ninja)** — from the `Endpoint https://rapidapi.com/letscrape.../jsearch/...` line through the end.
3. If **`docs/rapidapi-job-providers.md`** or code disagree with this file, **prefer this file** for raw parameter semantics; prefer **repo code** for what we actually implement.
4. When the user adds a **new vendor**, they will paste into `api-endpoint-vendors.txt`; regenerate or extend this `.md` with the same structure (vendor header + verbatim body).

---
## Vendor 1: Fantastic Jobs — LinkedIn Job Search API

Endpoint: https://rapidapi.com/fantastic-jobs-fantastic-jobs-default/api/linkedin-job-search-api

Query Params
limit
(optional)
Number

You can limit the number of jobs per API call between 10 and 100.

If left blank, the default value is 100

Use the offset parameter to receive the next batch of jobs
Default: 10
offset
(optional)
Number

Offset allows you to paginate results. For example, if you want to retrieve 300 jobs from our api you can send 3 requests with limit=100 and offset= 0, 100, and 200.

With a limit of 10, you can fetch 30 jobs using 3 requests with offset= 0, 10, and 20
Default: 0
title_filter
(optional)
String

Filter on the job title. You can search like you search on Google, see the documentation for more info.

For advanced filtering, including parenthesis and prefix wildcard searching, please use the advanced_title_filter
location_filter
(optional)
String

Filter on location. Please do not search on abbreviations like US, UK, NYC. Instead, search on full names like United States, New York, United Kingdom.

You may filter on more than one location in a single API call using the OR parameter. For example: Dubai OR Netherlands OR Belgium
description_filter
(optional)
String

Filter on the job description. You can search like you search on Google, see the documentation for more info.
organization_description_filter
(optional)
String

Filter on the job's organization LinkedIn description + specialties. You can search like you search on Google, see the documentation for more info.
organization_specialties_filter
(optional)
String

Filter on the job's organization LinkedIn specialties. You can search like you search on Google, see the documentation for more info.
organization_slug_filter
(optional)
String

Filter on the job's company via the slug. You can search on more than one company with a comma delimited list without spaces!. For example: organization_filter:microsoft,tesla-motors

Only allows for exact matches, please check the exact company slug before filtering.

The slug is the company specific part of the url. For example the slug in the following url is 'tesla-motors': https://www.linkedin.com/company/tesla-motors/

To exclude organization and other advanced queries, we recommend using advanced_organization_filter
description_type
(optional)
String

Description Type. Leave empty to return data without job description. Option 1: 'text' Option 2: 'html'
type_filter
(optional)
String

Filter on a specific job type, the options are: CONTRACTOR, FULL_TIME, INTERN, OTHER, PART_TIME, TEMPORARY, VOLUNTEER

To filter on more than one job type, please delimitd by comma, like such: FULL_TIME, PART_TIME
remote
(optional)
rapid_do_not_include_in_request_key
Boolean

Set to 'true' to include remote jobs only. Set to 'false' to include jobs that are not remote. Leave empty to include both remote and non remote jobs
agency
(optional)
rapid_do_not_include_in_request_key
Boolean

Use this to filter or filter-out recruitment agencies and job boards: TRUE = only recruitment agencies and job boards FALSE= only regular companies.

Please send us a message if you noticed any organizations with the wrong flag.
industry_filter
(optional)
String

Filter on the organization's LinkedIn Industry.

Please use the exact Industry. This filter is case sensitive.

Please note that all industries are now in English

You can filter on more than one industry with a comma delimited list without spaces. For example: industry_filter=Accounting,Staffing and Recruiting

If the industry contains a comma, please double-quote.

You can find a list of industries on our website
seniority_filter
(optional)
String

Filter on the seniority level as described on the LinkedIn jobs page.

Please use the exact seniorty description. This filter is case sensitive.

Please note that certain languages might not use the English description. We recommend use both the English and any foreign language seniority descriptions

You can filter on more than one seniority description with a comma delimited list without spaces. For example: seniority_filter=Mid-Senior level,Entry level

For English, you can use the following filters. Please note that these might change so we recommend regularly checking these: Associate, Director, Executive, Mid-Senior level, Entry level, Not Applicable, Internship

Due to employers using 'Not Applicable' regularly, we recommend only using this filter when you're happy with missing out on some jobs that might be relevant.
exclude_ats_duplicate
(optional)
rapid_do_not_include_in_request_key
Boolean

Set this parameter to true to remove the majority of duplicate jobs between this API and the 'Active Jobs DB' API. Please see the documentation for details

This is not a general deduplication parameter, do not use this if you don't use the 'Active Jobs DB' API
external_apply_url
(optional)
rapid_do_not_include_in_request_key
Boolean

Set to true to include only jobs with an external_apply_url.

The url's are not cleaned and might include trackers like source=linkedin, utm tags, etc
directapply
(optional)
rapid_do_not_include_in_request_key
Boolean

Include or exclude directapply (easyapply) jobs.
employees_lte
(optional)
Number

Use this to filter on jobs from companies less than a certain number of employees. Can be used in combination with employees_gte. For example, if you wish to filter on small companies but want to exclude companies with just one employee, you can use the following query filter: employees_gte=1 employees_lte=200
Default: 0
employees_gte
(optional)
Number

Use this to filter on jobs from companies greater than a certain number of employees. Can be used in combination with employees_lte. For example, if you wish to filter on small companies but want to exclude companies with just one employee, you can use the following query filter: employees_gte=1 employees_lte=200
Default: 0
date_filter
(optional)
String

Use this filter to return only the most recent jobs, instead of all jobs indexed during the last 24h. (our API can contain re-indexed jobs that were removed and reposted)

To include time, use the following syntax: '2025-01-01T14:00:00'

Please keep in mind that the jobs posted date/time is UTC and there's a 1 to 2 hour delay before jobs appear on this API.
order
(optional)
String

The order of the jobs is date descending by default, if you wish to order on date ascending, please use 'asc'
advanced_title_filter
(optional)
String

Advanced Title filter which enables more features like parenthesis, 'AND', and prefix searching.

Can Not be used in combination with regular title_filter

Phrares (two words or more) always need to be single quoted or use the operator <->

Instead of using natural language like 'OR' you need to use operators like:

    & (AND)
    | (OR)
    ! (NOT)
    <-> (FOLLOWED BY)
    ' ' (FOLLOWED BY alternative, does not work with 6. Prefix Wildcard)
    :* (Prefix Wildcard)

For example:

(AI | 'Machine Learning' | 'Robotics') & ! Marketing

Will return all jobs with ai, or machine learning, or robotics in the title except titles with marketing

Project <-> Manag:*

Will return jobs like Project Manager or Project Management

Please send us a message if you're getting errors
advanced_organization_filter
(optional)
String

Advanced Organization filter which enables more features like parenthesis, 'AND', and prefix searching.

Phrases (two words or more) always need to be single quoted or use the operator <->

Instead of using natural language like 'OR' you need to use operators like:

    & (AND)
    | (OR)
    ! (NOT)
    <-> (FOLLOWED BY)
    ' ' (FOLLOWED BY alternative, does not work with 6. Prefix Wildcard)
    :* (Prefix Wildcard)

For example:

University & ! Harvard

Will return all jobs with university in the organization name except harvard

Please send us a message if you're getting errors
include_ai
(optional)
rapid_do_not_include_in_request_key
Boolean

BETA Feature, applied on Tech and Prodcuct roles only. Jobs from recruitment agencies are excluded. Please see documentation for details

We're now extracting useful insights from the job description with AI. Please see the docs for all the included fields. Set to true to include all AI fields

Do you see a repeated mistake in the output? Please report here
ai_work_arrangement_filter
(optional)
String

BETA Feature. Filter on a specific work arrangement identified by our AI, This is a more granular version of the 'remote' filter, which is quite broad the options are:

    On-site (Job is on site only, no working from home available)
    Hybrid (Job is in the office with one or more days remote)
    Remote OK (Job is fully remote, but an office is available)
    Remote Solely (Job is fully remote, and no office is available)

To filter on more than one job type, please delimit by comma with no space, like such: Hybrid,Remote OK,Remote Solely
ai_experience_level_filter
(optional)
String

BETA Feature. Filter on a certain required experience level as identified by our AI, the options are:

0-2/2-5/5-10/10+

To filter on more than one job type, please delimit by comma with no space, like such: 0-2,2-5
ai_visa_sponsorship_filter
(optional)
rapid_do_not_include_in_request_key
Boolean

BETA Feature. Filter on a jobs that include a mention of Visa sponsorship within the job description.
ai_taxonomies_a_filter
(optional)
String

Filter the jobs on one or more top level taxonomies. You can choose from: Technology, Healthcare, Management & Leadership, Finance & Accounting, Human Resources, Sales, Marketing, Customer Service & Support, Education, Legal, Engineering, Science & Research, Trades, Construction, Manufacturing, Logistics, Creative & Media, Hospitality, Environmental & Sustainability, Retail, Data & Analytics, Software, Energy, Agriculture, Social Services, Administrative, Government & Public Sector, Art & Design, Food & Beverage, Transportation, Consulting, Sports & Recreation, Security & Safety

You can filter on more than one taxonomy with a comma delimited list without spaces!. For example: ai_taxonomies_a_filter:Technology,Healthcare

For taxonomies including &, please double-quote
ai_taxonomies_a_primary_filter
(optional)
String

Filter the jobs on one or more top level primary taxonomies. This filter will filter on the primary taxonomy only (the first taxonomy in the array)

You can filter on more than one taxonomy with a comma delimited list without spaces!. For example: ai_taxonomies_a_filter:Technology,Healthcare

For taxonomies including &, please double-quote
ai_taxonomies_a_exclusion_filter
(optional)
String

Use this parameter to exclude jobs with certain top level taxonomies from the results

You can filter out more than one taxonomy with a comma delimited list without spaces!. For example: ai_taxonomies_a_exclusion_filter:Technology,Healthcare

For taxonomies including &, please double-quote
ai_education_requirements_filter
(optional)
String
ai_has_salary
(optional)
rapid_do_not_include_in_request_key
Boolean

Set to 'true' to only include jobs with a salary, either listed in salary_raw or extracted from the job description with AI. Please set include_ai to true when using this field!
organization_filter
(optional)
String

Filter on the job's company. You can search on more than one company with a comma delimited list without spaces!. For example: organization_filter:Deloitte,Microsoft.

Only allows for exact matches, please check the exact company name before filtering.

Warning, this filter does not work for company names using parenthesis ( )



Request example

curl --request GET \
	--url 'https://linkedin-job-search-api.p.rapidapi.com/active-jb-24h?limit=10&offset=0&title_filter=%22Data%20Engineer%22&location_filter=%22United%20States%22%20OR%20%22United%20Kingdom%22&description_type=text' \
	--header 'Content-Type: application/json' \
	--header 'x-rapidapi-host: linkedin-job-search-api.p.rapidapi.com' \
	--header 'x-rapidapi-key: xxx'

Response JSON example

[
  {
    "id": "1885783067",
    "date_posted": "2025-10-13T13:34:45.7",
    "date_created": "2025-10-13T13:38:45.782401",
    "title": "Data Engineer",
    "organization": "ICP Search | Tech, Media & Sport",
    "organization_url": "https://uk.linkedin.com/company/icp-search",
    "date_validthrough": null,
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressRegion": "",
          "addressCountry": "",
          "addressLocality": "United Kingdom"
        }
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://uk.linkedin.com/jobs/view/data-engineer-at-icp-search-tech-media-sport-4311458228",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "uk.linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/C4D0BAQHMdQIuCli6Xw/company-logo_100_100/company-logo_100_100/0/1657014819451/icp_search_logo?e=2147483647&v=beta&t=pls2vXC_sFyyqhNvDgDU6POUIK1sFXTRQNebhqqXSzI",
    "cities_derived": null,
    "counties_derived": null,
    "regions_derived": null,
    "countries_derived": [
      "United Kingdom"
    ],
    "locations_derived": [
      "United Kingdom"
    ],
    "timezones_derived": [
      "Europe/London"
    ],
    "lats_derived": [
      54.7023545
    ],
    "lngs_derived": [
      -3.2765753
    ],
    "remote_derived": false,
    "linkedin_org_employees": 30,
    "linkedin_org_url": "http://www.icpsearch.com",
    "linkedin_org_size": "11-50 employees",
    "linkedin_org_slogan": "Executive search and talent solutions for organisations shaping the future of technology, media and sport.",
    "linkedin_org_industry": "Staffing and Recruiting",
    "linkedin_org_followers": 36187,
    "linkedin_org_headquarters": "Brighton, Sussex",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "2001",
    "linkedin_org_specialties": [
      ""
    ],
    "linkedin_org_locations": [
      "Brighton, Sussex, GB"
    ],
    "linkedin_org_description": "Since 2001, we’ve helped ambitious organisations find the people who drive growth, innovation and performance across technology, media and sport.\n\nWe specialise in executive search, specialist recruitment, embedded recruitment (RaaS), leadership insight and culture design — working closely with our partners to build high-performing teams, wherever they are in the world.\n\nOur clients include private equity firms, global tech companies, rights holders, broadcasters, content creators and sports organisations, from clubs and leagues to federations, all redefining how technology, performance and everyday experiences come to life.\n\nIf you’re building something special, we’d love to support you.",
    "linkedin_org_recruitment_agency_derived": true,
    "seniority": "Not Applicable",
    "directapply": true,
    "linkedin_org_slug": "icp-search",
    "no_jb_schema": true,
    "external_apply_url": null,
    "ats_duplicate": null,
    "description_text": "ICP has been retained by a Football Club that have entered an exciting new era. Backed by investors with a rich history in the utilisation of data, the club has set ambitious goals. With a strong commitment to innovation, they are adopting a pioneering, data-driven approach across all areas of the club. This is a rare opportunity to play a key role in shaping the future of performance analysis and decision-making within professional football.\n\nAbout the Role\nWe are seeking a Data Engineer to design, build, and maintain the data infrastructure that underpins performance and operational insights. This role will be central to ensuring that coaches, scouts, and staff have accurate, timely, and actionable data to support decision-making.\nThe ideal candidate will have strong cloud experience, with proven ability in Python, API integration, and web scraping. They will be skilled in storing and organising data effectively, with the ultimate goal of enabling powerful visualisations and presentations for coaches and scouts.\n\nKey Responsibilities\nDevelop and manage data pipelines and systems to support both performance and operational analysis.\nIntegrate multiple data sources (wearables, video, performance platforms, and more) into centralised systems.\nCollaborate with analysts, coaches, and staff to ensure data is accurate, reliable, and accessible.\nEnsure compliance with data security, governance, and best-practice standards.\nProvide technical expertise to enhance the clubs data-driven decision-making processes.\n\nKey Skills & Experience\nStrong cloud platform experience (e.g., AWS, Azure, or GCP).\nProficiency in Python for data engineering tasks.\nHands-on experience with APIs, web scraping, and data storage solutions.\nUnderstanding of data modelling and pipeline management.\nExperience working with large and varied datasets (performance, video, tracking, wearable data a plus).\nKnowledge of data visualisation tools (e.g., Power BI, Tableau, or custom dashboards) desirable.\nExcellent problem-solving skills and ability to work collaboratively in a fast-paced environment.\n\nWhy Join the Team\nBe part of a forward-thinking, ambitious club with promotion aspirations.\nWork at the forefront of data innovation in football.\nContribute directly to on-field and off-field success by enabling data-led decisions.\nJoin a collaborative team with the support of data-focused investors driving meaningful change.\nShow more Show less"
  },
  {
    "id": "1885779420",
    "date_posted": "2025-10-13T13:30:41",
    "date_created": "2025-10-13T13:33:38.852872",
    "title": "Senior Palantir data Engineer (Onsite)",
    "organization": "SRI Tech Solutions Inc.",
    "organization_url": "https://www.linkedin.com/company/sri-tech-solutions-inc",
    "date_validthrough": "2026-10-01T21:16:34",
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressCountry": "US",
          "addressLocality": "Dallas",
          "addressRegion": "TX",
          "streetAddress": null
        },
        "latitude": 32.777977,
        "longitude": -96.79621
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "CONTRACTOR"
    ],
    "url": "https://www.linkedin.com/jobs/view/senior-palantir-data-engineer-onsite-at-sri-tech-solutions-inc-3086699863",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/C560BAQH1WIdVvNmotg/company-logo_200_200/company-logo_200_200/0/1645812066403/sri_tech_solutions_inc_logo?e=2147483647&v=beta&t=f_c7t-uXMULnsPKL6uFD3cdM_HltPfcJAUVbLGRM2wY",
    "cities_derived": [
      "Dallas"
    ],
    "counties_derived": [
      "Dallas County"
    ],
    "regions_derived": [
      "Texas"
    ],
    "countries_derived": [
      "United States"
    ],
    "locations_derived": [
      "Dallas, Texas, United States"
    ],
    "timezones_derived": [
      "America/Chicago"
    ],
    "lats_derived": [
      32.7762719
    ],
    "lngs_derived": [
      -96.7968559
    ],
    "remote_derived": false,
    "linkedin_org_employees": 265,
    "linkedin_org_url": "http://www.sritechsolutions.com",
    "linkedin_org_size": "501-1,000 employees",
    "linkedin_org_slogan": "SRI Tech, a diversified HCM & IT Services Company. Providing solutions with a wide range of Software Engineers",
    "linkedin_org_industry": "IT Services and IT Consulting",
    "linkedin_org_followers": 41635,
    "linkedin_org_headquarters": "Tampa, Florida",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "2005",
    "linkedin_org_specialties": [
      "It staffing",
      "Off shore Development ",
      "It Services",
      "Product Development",
      "It Consulting",
      "Web Development",
      "Workforce Management ",
      "System Integration",
      "Enterprises Solutions",
      "Human resources",
      "Recruitment",
      "and Recruiting"
    ],
    "linkedin_org_locations": [
      "15310 Amberly, Drive Suite, 200, Tampa, Florida 33647, US",
      "Marikavalasa Road, Behind Metro Cash & Carry Marikavalasa, Madhurawada, Visakhapatnam, Andhra Pradesh 530048, IN",
      "Gachibowli Road, 1st Floor, Suite #16, Jayabheri Enclave, Hyderabad, Telangana 500032, IN",
      "218 Lormont Blvd, Stoney Creek, Ontario L8J 0J9, CA",
      "Avenida Peñuelas 106, Vista 2000, Querétaro, Querétaro 76140, MX"
    ],
    "linkedin_org_description": "SRI Tech is a solutions and resource placement enterprise that brings accomplishment and success to our clients. We have a full range of IT services that we deliver effectively and efficiently. We understand that all clients have a unique environment and that filling resources into projects is not such a simple task. This is why we work close in understanding our client’s environment to be able to integrate consultants onto its projects seamlessly and effectively. We offer solutions for all managed services, projects, and staffing. We also offer offshore development and products catered to client needs. SRI Tech is committed in providing the best business practices in the industry to help clients expand and compete in the market.\n\nSRI TECH SOLUTIONS is an Equal Employment Opportunity Employer M/F/V/D\n\nAccreditations:\n\n1. IMAGE Certified Company (ICE Mutual Agreement between Government and Employer).\n\n2. BBB (Better Business Bureau) Accredited Company with A+Rating.\n\n3. Recognized in America's fastest-growing private companies (INC 500).\n\n4. Ranked in Tampa Bay Business Journal (Fast 50).\n\n5. Recognized in Florida Fast 100 Companies.\n\n6. Ranked in Deloitte Technology Fast 500 Companies.\n\n7. Certification in Quality Management according to ISO 9001:2015 standards.\n\n8. IT Service Management certification based on ISO/IEC 20000-1:2018.\n\n9. Certification in Information Security Management following ISO/IEC 27001:2022 standards.\n",
    "linkedin_org_recruitment_agency_derived": true,
    "seniority": "Mid-Senior level",
    "directapply": true,
    "linkedin_org_slug": "sri-tech-solutions-inc",
    "no_jb_schema": null,
    "external_apply_url": null,
    "ats_duplicate": null,
    "description_text": "Job Description: \nPalantir data Engineer \nMonitor and respond to team chats and ticketing systems to address support issues in real-time.\nTroubleshoot and resolve issues related to:\nNew Data Ingestion\nUI/UX Changes\nData Quality and Integrity\nAdhoc Business Requests\nCollaborate with cross-functional teams including the Campaign Lifecycle Management Team, Customer Success Managers, Officer Support Teams, and data teams to ensure timely resolution of issues.\nDocument each issue including the solution to contribute to knowledge base.\nWhen bandwidth allows, provide support for the AI Agent Foundry initiative, contributing to the development and maintenance of AI-driven solutions.\nQualifications:\nExperience in developing robust ETLs and ensuring data quality\nStrong analytical and problem-solving skills\nAble to communicate with the business and technology teams\nVery collaborative and coachable\nAbility to pivot when needed\nExperience with data platforms, ingestion pipelines, or UI/UX troubleshooting is a plus\nExposure to GenAI, AI/ML tools or platforms is a bonus\nPreferred Skills:\nSQL, Snowflake, Python, Databricks, Azure\nPalantir is a bonus"
  },
  {
    "id": "1885779397",
    "date_posted": "2025-10-13T13:28:00",
    "date_created": "2025-10-13T13:33:37.272802",
    "title": "Data Engineer",
    "organization": "Insight Global",
    "organization_url": "https://www.linkedin.com/company/insight-global",
    "date_validthrough": "2025-11-12T13:27:59",
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressCountry": "US",
          "addressLocality": "Atlanta",
          "addressRegion": "GA",
          "streetAddress": null
        },
        "latitude": 33.761196,
        "longitude": -84.39589
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": {
      "@type": "MonetaryAmount",
      "currency": "USD",
      "value": {
        "@type": "QuantitativeValue",
        "minValue": 100000,
        "maxValue": 120000,
        "unitText": "YEAR"
      }
    },
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://www.linkedin.com/jobs/view/data-engineer-at-insight-global-4314018540",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/C560BAQGUNIyRZFaj0g/company-logo_200_200/company-logo_200_200/0/1657049194702/insight_global_logo?e=2147483647&v=beta&t=qgSY6S4vpAzMXSPhYkkhODSkHvK35KUnT1qfp9mqNA4",
    "cities_derived": [
      "Atlanta"
    ],
    "counties_derived": [
      "Fulton County"
    ],
    "regions_derived": [
      "Georgia"
    ],
    "countries_derived": [
      "United States"
    ],
    "locations_derived": [
      "Atlanta, Georgia, United States"
    ],
    "timezones_derived": [
      "America/New_York"
    ],
    "lats_derived": [
      33.7489924
    ],
    "lngs_derived": [
      -84.3902644
    ],
    "remote_derived": false,
    "linkedin_org_employees": 16933,
    "linkedin_org_url": "https://insightglobal.com",
    "linkedin_org_size": "1,001-5,000 employees",
    "linkedin_org_slogan": "A leading global staffing company dedicated to empowering people",
    "linkedin_org_industry": "Staffing and Recruiting",
    "linkedin_org_followers": 4490663,
    "linkedin_org_headquarters": "Atlanta, Georgia",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "2001",
    "linkedin_org_specialties": [
      "Professional Services",
      "Business Services",
      "Staffing",
      "Talent Solutions",
      "Technical Solutions",
      "Recruiting",
      "Global Capabilities",
      "Engineering",
      "Healthcare",
      "IT",
      "Nearshore Staffing",
      "Offshore Staffing",
      "Project Delivery",
      "Accounting",
      "Finance",
      "Cloud Services",
      "Artificial Intelligence (AI)",
      "Data Services",
      "IT Service Management",
      "and Executive Search"
    ],
    "linkedin_org_locations": [
      "1224 Hammond Drive, Suite 1500, Atlanta, Georgia 30346, US",
      "100 King St W, Suite 5210, Toronto, Ontario M5X 1A9, CA",
      "1901 6th Ave N, Suite 1610, Birmingham, Alabama 35203, US",
      "2325 E Camelback Rd, Suite 800, Phoenix, Arizona 85016, US",
      "5001 W Founders Way, Suite 100, Rogers, Arkansas 72758, US",
      "609 Granville St, Suite 540, Vancouver, British Columbia V7Y 1H4, CA",
      "401 W A St, Suite 2075, San Diego, California 92101, US",
      "400 Capitol Mall, Suite 2640, Sacramento, California 95814, US",
      "3161 Michelson Dr, Suite 1150, Irvine, California 92612, US",
      "6601 Center Dr W, 5th Floor, Suite J, Los Angeles, California 90045, US",
      "33 New Montgomery St, Suite 1700, San Francisco, California 94105, US",
      "50 W San Fernando St, Suite 900, San Jose, California 95113, US",
      "707 17th St, Suite 4100, Denver, Colorado 80202, US",
      "185 Asylum St, City Place 2, 15th Floor, Hartford, Connecticut 06103, US",
      "4 Star Point, Suite 302, Stamford, Connecticut 06902, US",
      "1001 19th St N, Suite 1000, Arlington, Virginia 22209, US",
      "5200 Town Center Circle, Boca Center, Tower 1, Suite 500, Boca Raton, Florida 33486, US",
      "333 S Garland Ave, Suite 1200, Orlando, Florida 32801, US",
      "3600 Midtown Dr, Suite 1000, Tampa, Florida 33607, US",
      "5555 Gate Pkwy, Suite 220, Jacksonville, Florida 32256, US",
      "333 SE 2nd Ave, Suite 3400, Miami, Florida 33131, US",
      "353 N Clark St, 2200, Chicago, Illinois 60654, US",
      "820 Massachusetts Ave, Suite 1360, Indianapolis, Indiana 46204, US",
      "666 Walnut St, Suite 1600, Des Moines, Iowa 50309, US",
      "101 South 5th Street, Suite 1800, Louisville, KY 40202, US",
      "100 E Pratt St, Suite 2530, Baltimore, Maryland 21202, US",
      "33 Arch St, Suite 1120, Boston, Massachusetts 02110, US",
      "333 Bridge St NW, 13th Floor, Suite 1301, Grand Rapids, Michigan 49504, US",
      "400 Renaissance Dr, Suite 3500, Detroit, Michigan 48243, US",
      "1601 Utica Ave S, Suite 800, St Louis Park, Minnesota 55416, US",
      "231 S Bemiston Ave, Suite 100, St Louis, Missouri 63105, US",
      "1100 Walnut St, Suite 1250, Kansas City, Missouri 64106, US",
      "6700 Mercy Rd, Suite 300, Omaha, Nebraska 68106, US",
      "3800 Howard Hughes Pkwy, Suite 600, Las Vegas, Nevada 89169, US",
      "1260 Headquarters Plaza, West Tower, 6th Floor, Morristown, New Jersey 07960, US",
      "250 Park Ave, Suite 1100, New York, New York 10177, US",
      "201 N Tryon St, Suite 2150, Charlotte, North Carolina 28202, US",
      "4208 Six Forks Rd, Suite 840, Raleigh, North Carolina 27609, US",
      "250 E 5th St, Suite 1400, Cincinnati, Ohio 45202, US",
      "127 Public Sq, Suite 1500, Cleveland, Ohio 44114, US",
      "210 Park Ave, Suite 1020, Oklahoma City, Oklahoma  73102, US",
      "111 SW 5th Ave, Suite 3850, Portland, Oregon 97204, US",
      "1 PPG Pl, Suite 2000, Pittsburgh, Pennsylvania 15222, US",
      "1600 Market St, Suite 2900, Philadelphia, Pennsylvania 19103, US",
      "200 N Warner Rd, Oak Hill Plaza, Suite 440, King of Prussia, Pennsylvania 19406, US",
      "1222 Demonbreun St, Suite 1100, Nashville, Tennessee 37203, US",
      "401 Congress Ave, Suite 1600, Austin, Texas 78701, US",
      "2100 McKinney Ave, Suite 1400, Dallas, Texas 75201, US",
      "111 W. Houston Street, Suite 2005, San Antonio, Texas 78205, US",
      "2200 Post Oak Blvd, Suite 1225, Houston, Texas 77056, US",
      "111 South Main, Suite 2250, Salt Lake City, Utah 84111, US",
      "1021 E Cary St, Suite 1850, Richmond, Virginia 23219, US",
      "4500 Main Street, Suite 210, Virginia Beach, Virginia 23462, US",
      "800 Bellevue Way NE, Suite 400, Bellevue, Washington 98004, US",
      "833 E Michigan St, Suite 650, Milwaukee, Wisconsin 53202, US",
      "330 Rush Alley, Suite 850, Columbus, Ohio 43215, US",
      "700 2nd Street SW Calgary, Suite 3100, Calgary , Alberta T2P 2W2, CA",
      "997 Morrison Drive 6th Floor, suite 602, Charleston , South Carolina  29403, US",
      "15 S Main St, Suite 500, Greenville , South Carolina  29601, US",
      "6815 Poplar Ave, Germantown, Tennessee 38138, US",
      "201 Saint Charles Ave, Suite 2405, New Orleans, Louisiana 70170, US",
      "200 Westside Sq, Suite 500, Huntsville, Alabama 35801, US",
      "17 Saint Helen's Place, 4th Floor, London, England EC3A 6DG, GB",
      "3 W Garden St, Suite 217, Pensacola, Florida 32502, US",
      "1100 W Idaho St, Suite 310, Boise, Idaho 83702, US",
      "1110 Market St, Suite 215, Chattanooga, Tennessee 37402, US",
      "640 Taylor St, 14th floor, Fort Worth, Texas 76102, US",
      "99 Bank St, Suite 1002, Ottawa, Ontario K1P 6B9, CA",
      "345 King St, Suite 202, Kitchener, Ontario N2G 1B8, CA"
    ],
    "linkedin_org_description": "Insight Global is an international professional services and staffing company specializing in delivering talent and technical solutions to Fortune 1000 companies across the IT, Non-IT, Healthcare, and Engineering industries. Fueled by staffing and talent experts, Evergreen, our professional services brand, brings technical advisors and culture consultants to help customers tackle their biggest challenges. With over 70 locations across North America, Europe, and Asia, and global staffing capabilities in 50+ countries, our teams of tech-enabled recruiters are dedicated to finding the right talent and technical solutions to help our customers thrive. At our core, we are dedicated to empowering people to do great things. That’s why we’re passionate about developing our people personally, professionally, and financially so they can be the light to the world around them. To find out more, visit www.insightglobal.com",
    "linkedin_org_recruitment_agency_derived": true,
    "seniority": "Mid-Senior level",
    "directapply": true,
    "linkedin_org_slug": "insight-global",
    "no_jb_schema": null,
    "external_apply_url": null,
    "ats_duplicate": null,
    "description_text": "Role: Data Engineer\nType: Direct Placement / Full-time\nLocation: Atlanta, GA 30313– in-office 2-3 days per week in Midtown\nCompensation: $120K base salary, up to 20% performance based annual bonus\n\nMust Haves:\nRobust SQL skills -- should be able to write code from scratch (not just modifying existing queries) including building an application in SQL.\nStrong experience working with large sets of complex data such as financial, sales, supply chain, logistics data, etc.\nHands-on experience with ETL, preferably with Azure Data Factory (ADF), but open to other comparable ETL tools.\nStrong experience with some form of BI tool such as Power BI, Tableau, Alteryx, etc.\nExtremely strong communication skills with proven experience in speaking to technical audiences and business leaders alike and influencing stakeholders and project partners to achieve results.\n\nPlusses:\nExperience as a data engineer or a software developer\nExperience working in a client facing environment where you've owned the delivery of a product from start to finish."
  },
  {
    "id": "1885779362",
    "date_posted": "2025-10-13T13:21:01",
    "date_created": "2025-10-13T13:33:34.123996",
    "title": "Data Engineer (Google cloud experience)",
    "organization": "Stefanini Group",
    "organization_url": "https://www.linkedin.com/company/stefanini",
    "date_validthrough": "2025-11-12T13:21:01",
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressCountry": "US",
          "addressLocality": "Southfield",
          "addressRegion": "MI",
          "streetAddress": null
        },
        "latitude": 42.480198,
        "longitude": -83.241
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://www.linkedin.com/jobs/view/data-engineer-google-cloud-experience-at-stefanini-group-4270324696",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/D560BAQGxw8ejZKpVTA/company-logo_200_200/company-logo_200_200/0/1689014804966/stefanini_logo?e=2147483647&v=beta&t=hNMT5FS3YnT9nQqk_8uU0ocIM1kz7u5g8BDfW63D1S8",
    "cities_derived": [
      "Southfield"
    ],
    "counties_derived": [
      "Oakland County"
    ],
    "regions_derived": [
      "Michigan"
    ],
    "countries_derived": [
      "United States"
    ],
    "locations_derived": [
      "Southfield, Michigan, United States"
    ],
    "timezones_derived": [
      "America/Detroit"
    ],
    "lats_derived": [
      42.4733689
    ],
    "lngs_derived": [
      -83.2218731
    ],
    "remote_derived": false,
    "linkedin_org_employees": 24734,
    "linkedin_org_url": "https://stefanini.com",
    "linkedin_org_size": "10,001+ employees",
    "linkedin_org_slogan": null,
    "linkedin_org_industry": "Business Consulting and Services",
    "linkedin_org_followers": 395269,
    "linkedin_org_headquarters": "São Paulo, SP",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "",
    "linkedin_org_specialties": [
      ""
    ],
    "linkedin_org_locations": [
      "Avenida Eusébio Matoso 1375, São Paulo, SP 05423-905, BR"
    ],
    "linkedin_org_description": "Global Tech Consulting Company All in One. \n \nStefanini is a Brazilian multinational company with 37 years of experience and presence in 41 countries. With more than 35,000 employees, we co-create solutions for a better future, driving digital transformation with a focus on real results. \n \n\nWe operate in an integrated way through 7 specialized business units: Consulting (Technology and Business Agility), Analytics & AI, Banking & Payments, Cybersecurity, Manufacturing 4.0, and Digital Marketing. \n \n\nRecognized as the most internationalized technology company in Brazil, according to the Fundação Dom Cabral (FDC) ranking, Stefanini is global by essence, collaborative by nature, and strategic by vocation. It is also a pioneer in applying Artificial Intelligence to transform businesses through an end-to-end AI-First approach.",
    "linkedin_org_recruitment_agency_derived": false,
    "seniority": "Entry level",
    "directapply": true,
    "linkedin_org_slug": "stefanini",
    "no_jb_schema": null,
    "external_apply_url": null,
    "ats_duplicate": null,
    "description_text": "Company Description\nStefanini is a Brazilian multinational company with 37 years of experience, operating in 41 countries, and employing over 38,000 individuals. We specialize in driving digital transformation with a focus on tangible results. Our company operates through seven specialized business units: Consulting, Analytics & AI, Banking & Payments, Cybersecurity, Manufacturing 4.0, and Digital Marketing. Recognized as the most internationalized technology company in Brazil, we are pioneers in leveraging Artificial Intelligence to transform businesses.\n\nRole Description\nThis is a full-time, on-site role for a Data Engineer located in Southfield, MI. The Data Engineer will be responsible for designing, developing, and maintaining scalable data pipelines and systems. Day-to-day tasks include performing data modeling, creating and managing ETL processes, and building data warehousing solutions. Additionally, the Data Engineer will work closely with the analytics team to extract insights and support data-driven decision-making.\n\nQualifications\nProficiency in Data Engineering and Data Modeling\n2+ years experience with Google Cloud Platform (GCP)\nExperience with Extract Transform Load (ETL) processes and Data Warehousing\nStrong skills in Data Analytics\nExcellent problem-solving skills and attention to detail\nBachelor's degree in Computer Science, Information Technology, or related field\nStrong communication skills and the ability to work collaboratively\nPrevious experience in a similar role is a plus"
  },
  {
    "id": "1885772892",
    "date_posted": "2025-10-13T13:05:07.829",
    "date_created": "2025-10-13T13:06:07.918569",
    "title": "Data Engineer / Consultant",
    "organization": "Noble Dynamic",
    "organization_url": "https://uk.linkedin.com/company/noble-dynamic",
    "date_validthrough": null,
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressRegion": "",
          "addressCountry": "",
          "addressLocality": "United Kingdom"
        }
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://uk.linkedin.com/jobs/view/data-engineer-consultant-at-noble-dynamic-4314121901",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "uk.linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/D4E0BAQHocqfC-96z4g/company-logo_100_100/company-logo_100_100/0/1661597463030?e=2147483647&v=beta&t=174iuIBf1DxJWq8SIrUjLFvxXsuBW8vsUsV0s9m3pnw",
    "cities_derived": null,
    "counties_derived": null,
    "regions_derived": null,
    "countries_derived": [
      "United Kingdom"
    ],
    "locations_derived": [
      "United Kingdom"
    ],
    "timezones_derived": [
      "Europe/London"
    ],
    "lats_derived": [
      54.7023545
    ],
    "lngs_derived": [
      -3.2765753
    ],
    "remote_derived": false,
    "linkedin_org_employees": 1,
    "linkedin_org_url": "https://nobledynamic.com",
    "linkedin_org_size": "1 employee",
    "linkedin_org_slogan": "Data and cloud consultancy. Get real value and actionable insight out of your data",
    "linkedin_org_industry": "Data Infrastructure and Analytics",
    "linkedin_org_followers": 55,
    "linkedin_org_headquarters": "Liverpool Street, England",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "2022",
    "linkedin_org_specialties": [
      "Machine Learning",
      "AI",
      "Software",
      "Strategy",
      "and Data"
    ],
    "linkedin_org_locations": [
      "86-90 Paul Street, Liverpool Street, England EC2A 4NE, GB"
    ],
    "linkedin_org_description": "Noble Dynamic is a data, cloud and software consultancy focused on helping businesses get real value and actionable insight out of data. No matter what type or where, we can help.\n\nStrategic partner with Journi, helping our customers to achieve enhanced insights and automation through the power of data, analytics and applied AI.\n\nServices include:\nData Science\nData Engineering\nComputer Vision\nDashboards and Visualisation\nData Strategy\nCloud",
    "linkedin_org_recruitment_agency_derived": false,
    "seniority": "Mid-Senior level",
    "directapply": true,
    "linkedin_org_slug": "noble-dynamic",
    "no_jb_schema": true,
    "external_apply_url": null,
    "ats_duplicate": null,
    "description_text": "We’re seeking a Data Engineer to join a growing consulting practice delivering modern data solutions on Microsoft Fabric. You’ll work alongside an experienced freelance data and software engineer across multiple client projects, helping design and implement scalable, efficient data platforms and analytics solutions.\nThe role offers flexibility - ideal for someone looking for part-time or full-time contract work in a dynamic, project-based environment.\n\nKey Responsibilities\nDesign, build, and maintain data pipelines using Microsoft Fabric / Data Factory\nDevelop and optimise data warehouse models (star schema, medallion, etc.)\nBuild and manage Power BI datasets, dataflows, and reports\nWork with diverse data sources (SQL Server, APIs, SharePoint, etc.)\nSupport data ingestion, transformation, and orchestration using metadata frameworks or Azure-native tooling\nImplement and uphold data quality, performance, and governance standards\nCollaborate on solution design and contribute to DevOps practices (Git, CI/CD pipelines)\nDocument data models, processes, and pipeline logic clearly and efficiently\n\nCore Skills & Experience\n3–5 years’ experience in a data engineering or BI development role\nStrong proficiency with: Microsoft Fabric or Azure Synapse / Data Factory, Power BI (data modelling, DAX, dataset optimisation), SQL and relational data modelling\nExperience building data pipelines and ETL/ELT processes\nFamiliarity with data warehousing concepts and best practices\nUnderstanding of Azure data services and cloud-based architectures\n\nNice to Have\nPython for automation and data transformations\nExperience with Spark (PySpark / Fabric notebooks / Databricks)\nExposure to Airflow or similar orchestration tools\nFamiliarity with DevOps pipelines (Azure DevOps, GitHub Actions, or CircleCI)\nExperience integrating AI / machine learning or predictive analytics into reporting\nConsulting or client-facing experience\nRelevant certifications\n\nAbout the Projects\nYou’ll contribute to data platform solutions for clients transitioning to Microsoft Fabric, replacing legacy reporting systems with modern, scalable architectures. Typical work includes building ELT pipelines, designing star-schema models, and developing robust Power BI reports to enable data-driven decision-making.\n\nIdeal Candidate\nYou’re someone who:\nEnjoys building practical, reliable data solutions\nWorks well independently but collaborates openly\nCommunicates clearly and takes ownership of deliverables\nHas a continuous learning mindset and curiosity about new tools and patterns\n\n\nShow more Show less"
  },
  {
    "id": "1885772635",
    "date_posted": "2025-10-13T13:01:41",
    "date_created": "2025-10-13T13:05:36.536855",
    "title": "Marketing Data Engineer",
    "organization": "Bulk™",
    "organization_url": "https://www.linkedin.com/company/bulkofficial",
    "date_validthrough": "2025-12-06T16:14:33",
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressCountry": "GB",
          "addressLocality": "London Area",
          "addressRegion": null,
          "streetAddress": null
        },
        "latitude": 51.51649,
        "longitude": -0.128427
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://uk.linkedin.com/jobs/view/marketing-data-engineer-at-bulk%E2%84%A2-4309287231",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "uk.linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/D4E0BAQHovxza1vqnuw/company-logo_200_200/B4EZZtpMCNHYAI-/0/1745596236407/bulkofficial_logo?e=2147483647&v=beta&t=4l-CXtIHE4e_eU18IkZJqnhF1K1p8orgbNbRsNKMds4",
    "cities_derived": [
      "London"
    ],
    "counties_derived": [
      "Greater London"
    ],
    "regions_derived": [
      "England"
    ],
    "countries_derived": [
      "United Kingdom"
    ],
    "locations_derived": [
      "London, England, United Kingdom"
    ],
    "timezones_derived": [
      "Europe/London"
    ],
    "lats_derived": [
      51.5074456
    ],
    "lngs_derived": [
      -0.1277653
    ],
    "remote_derived": false,
    "linkedin_org_employees": 299,
    "linkedin_org_url": "https://www.bulk.com",
    "linkedin_org_size": "201-500 employees",
    "linkedin_org_slogan": null,
    "linkedin_org_industry": "Wellness and Fitness Services",
    "linkedin_org_followers": 32958,
    "linkedin_org_headquarters": "London, England",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "",
    "linkedin_org_specialties": [
      "Sports Nutrition",
      "Protein Shakes",
      "High Protein Foods",
      "Vitamins & Minerals",
      "Health Food",
      "Supplements",
      "Sporting Goods",
      "and Health & Beauty"
    ],
    "linkedin_org_locations": [
      "1 Finsbury Avenue, London, England EC2M 2PF, GB",
      "Unit 1, Gunfleet Business Park, Brunel Way, Colchester, Essex CO4 9QX, GB",
      "ul. Łąkowa 23, Mirków, Mirków 55-095, PL"
    ],
    "linkedin_org_description": "Bulk™ is on an incredible journey, with a mission to become the only destination brand for active nutrition. \n\nWe are shaking up the sports nutrition industry through disruptive marketing campaigns that help people think differently about our brand.\n\nSince 2006, we’ve been dedicated to empowering every athlete and every person  with the right nutrition and inspiration they need to  set their goals, achieve them, and surpass them.\n\nWe believe that sport, health and fitness is for everyone, no matter who you are, what you do, how you do it, and a healthy lifestyle is a process that never truly stops.\n\nThat’s why we’ve committed ourselves to creating world-class and the very best in nutrition for every step of that process.",
    "linkedin_org_recruitment_agency_derived": false,
    "seniority": "Associate",
    "directapply": false,
    "linkedin_org_slug": "bulkofficial",
    "no_jb_schema": null,
    "external_apply_url": "https://careers.bulk.com/jobs/6549558-consumer-data-engineer?utm_source=LinkedIn",
    "ats_duplicate": false,
    "description_text": "#TEAMBULK ARE HIRING A CONSUMER DATA ENGINEER\n\nBulk™ is on an incredible journey, with a mission to move the business from a manufacturing-led retailer to a destination brand for active nutrition. We are shaking up the sports nutrition industry through disruptive marketing campaigns that help people think differently about our brand – and we want you to be a part of it!\n\nWe want passionate risk-takers. We want people that like to challenge our thinking. We want people that live and breathe digital and have an affinity to the world of nutrition, health, fitness, and sports.\n\nIN A NUTSHELL\n\nAs a Data Engineer in our Marketing Insights team, you will transform fragmented data into clean, reusable products across key domains like customer behavior, marketing, and product performance. You will help design scalable pipelines, build tools that enable teams to trust and activate data, and collaborate closely with Marketing, Product, and Analytics to drive Bulk’s growth.\nWe’re looking for a data engineer excited to shape the future of consumer data, from sourcing and modeling to delivery and analysis. Together, we set standards, champion quality, and build data products the business can rely on with confidence.\n\nYou’ll work on meaningful projects where data directly supports marketing, product decisions, and customer experience, while having the space to develop your skills beyond engineering - particularly in analytics, visualisation, and cross-functional presentation. As part of a collaborative and focused team, you’ll be supported in an environment that values clarity, ownership, and growth.\n\nWHAT WILL YOU BE DOING? \n\nData Pipeline Development\nDesign, build, and maintain batch and real-time data pipelines using tools like BigQuery, dbt, and Airflow.\nMonitor performance and reliability, and make improvements as needed.\nData Integration\nIngest and integrate core business data sources (i.e. Adobe CDP, Emarsys, Magento, Paid Media platforms) to the central data warehouse (BigQuery)\nSupport projects involving customer data unification, segmentation, and campaign data flow in Adobe CDP.\nData Quality and Governance\nSet up validation checks, resolve data quality issues, and maintain documentation\nPartner with the System Architect to align on governance standards and best practices.\nAnalytics and Visualisation Support\nCollaborate with analysts and marketers to support Tableau dashboards and reporting.\nContribute to analysis around customer segmentation, marketing performance, and other business needs.\nCollaborating with Teammates\nWork closely with teams across the business to understand data needs and use cases.\nHelp them access and interpret the data they need, while maintaining performance and reliability end-to-end.\n\nWHAT ARE WE LOOKING FOR? \n\nExperience (1–2 years): Proficient in SQL, Python, and API development, with a solid understanding of data structures and transformations.\nCloud & Data Engineering Skills: Experienced in data processing within cloud environments, preferably with exposure to Google Cloud Platform, dbt, and Airflow.\nAdaptable Problem-Solver: Comfortable navigating ambiguity, tackling loosely defined challenges, and thriving in autonomous team environments.\nData Modeling: Strong data modeling capabilities and a product-oriented approach to treating data as a core asset.\nGrowth-Oriented: Eager to further develop skills in Consumer analytics, reporting, and data visualization.\nCollaborator: Builds strong, positive relationships across both technical and business domains.\nCuriosity: an absolute must for any successful candidate. Ask questions, seek out opportunities, and don’t be afraid to take the initiative, roll up your sleeves, and solve problems yourself.\n\nWHAT ARE THE GAINS?\nMonthly Bulk Bank Benefits Allowance 🏦 including a subsidised Gym Membership 🏋️\nA day off to celebrate your Birthday 🎂\nPerkBox Subscription 👍\n60% discount on all Bulk™ products 💰\nFlexi Start 🕙\nAdditional Annual Leave (optional) 🌴\nTeammate Pension Scheme 💰\nLife Assurance 💟\nMedicash 👩 ⚕️\nA day off for Volunteering (optional) 🤗\nCycle to Work Scheme 🚲\nEnhanced Maternity & Paternity leave 🐣 and workplace nursery scheme 🧒\nBulk™ Pantry 🍴\nHappy Hour Drinks Fridge (Thursdays & Fridays) 🎉\nSummer Working Hours 🌞\n\nLOCATION: London\nHYBRID: 3 days in the office, 2 days working from home\n\nOUR COMMITMENT 🌈\n\nBulk™ is a place where employees have a voice fundamental to our success as a business. Building a diverse and inclusive team enables us to reach and connect with our global customers, from developing delicious recipes to how our brand is built and perceived.\n\nRegardless of age, disability, race, gender, religion, sexual orientation, education, neurodiversity or any protected characteristic, if you are a passionate risk-taker and eager to make a difference in sports nutrition, we want to hear from you. We know that a CV doesn’t begin to scratch the surface, and that the things that make you who you are could be a real game-changer for us. We are proud to be an equal opportunities employer."
  },
  {
    "id": "1885771951",
    "date_posted": "2025-10-13T12:59:12",
    "date_created": "2025-10-13T13:04:43.47761",
    "title": "Staff Data Engineer",
    "organization": "Pragmatike",
    "organization_url": "https://www.linkedin.com/company/pragmatikee",
    "date_validthrough": "2025-11-12T12:59:11",
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressCountry": "GB",
          "addressLocality": "London",
          "addressRegion": null,
          "streetAddress": null
        },
        "latitude": 51.506824,
        "longitude": -0.12611847
      }
    ],
    "location_type": "TELECOMMUTE",
    "location_requirements_raw": [
      {
        "@type": "Country",
        "name": "London, England, United Kingdom"
      }
    ],
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://uk.linkedin.com/jobs/view/staff-data-engineer-at-pragmatike-4314033137",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "uk.linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/D560BAQE3Psl7I4KFdQ/company-logo_200_200/company-logo_200_200/0/1736269088036/pragmatikee_logo?e=2147483647&v=beta&t=AWL_IXyjzzZ0cP8QXIM_64G5vHcehYPp2y5RDJi5Ltw",
    "cities_derived": [
      "London"
    ],
    "counties_derived": [
      "Greater London"
    ],
    "regions_derived": [
      "England"
    ],
    "countries_derived": [
      "United Kingdom"
    ],
    "locations_derived": [
      "London, England, United Kingdom"
    ],
    "timezones_derived": [
      "Europe/London"
    ],
    "lats_derived": [
      51.5074456
    ],
    "lngs_derived": [
      -0.1277653
    ],
    "remote_derived": true,
    "linkedin_org_employees": 11,
    "linkedin_org_url": "www.pragmatike.com",
    "linkedin_org_size": "11-50 employees",
    "linkedin_org_slogan": "Revolutionize your recruitment with a pragmatic approach",
    "linkedin_org_industry": "IT Services and IT Consulting",
    "linkedin_org_followers": null,
    "linkedin_org_headquarters": "Paris",
    "linkedin_org_type": "Partnership",
    "linkedin_org_foundeddate": "2022",
    "linkedin_org_specialties": [
      ""
    ],
    "linkedin_org_locations": [
      "Paris, FR",
      "834 Lake St, San Francisco, California 94118, US"
    ],
    "linkedin_org_description": "Hire the top 1% of remote tech talent with Pragmatike global reach. Trusted by remote-first companies worldwide 🧬. \n\n→ Hiring process in 48 hours\n→ 50K+ tech specialists \n→ Operating in 60+ countries \n\nCome chat with us, whether you look for talent or new career opportunities :) ",
    "linkedin_org_recruitment_agency_derived": true,
    "seniority": "Not Applicable",
    "directapply": false,
    "linkedin_org_slug": "pragmatikee",
    "no_jb_schema": null,
    "external_apply_url": "https://www.careers-page.com/pragmatike/job/63W574R5?utm_medium=free_job_board&utm_source=linkedin",
    "ats_duplicate": null,
    "description_text": "Job Description\n\nLocation: Fully remote, EU timezone (CET ± 2 hours)\n\nStart date: ASAP\n\nLanguages: English is mandatory; French is a plus\n\nIndustry: Cloud Computing / Blockchain services European SaaS\n\nAt Pragmatike, we are expanding our Data Engineering team to support the rapid growth of our internal projects. We focus on building innovative solutions in Cloud Computing, Blockchain, and Artificial Intelligence, with a strong emphasis on scalability, performance, and data-driven decision-making. Joining us means working in a collaborative environment where your expertise and leadership directly shape the foundation of our data infrastructure and product capabilities.\n\nIf youre passionate about designing reliable data architectures, mentoring other engineers, and driving technical excellence in a fast-moving startup environment wed love to hear from you!\n\nResponsabilities\n\nDesign, build, and scale robust data architectures and ETL pipelines to support analytics, product insights, and AI-driven initiatives.\nLead data migration and modernization projects (e.g., transitioning from Tableau to Looker or other BI platforms).\nCollaborate with Product, Engineering, and Analytics teams to define data instrumentation, collection, and governance strategies.\nEnsure data quality, integrity, and availability across multiple domains (product, marketing, customer, finance, etc.).\nImplement and optimize data processing and storage solutions in the cloud (AWS, GCP, or Azure).\nBuild and maintain monitoring, alerting, and observability systems for data workflows.\nContribute to predictive and forecasting models, supporting advanced analytics and machine learning efforts.\nDefine and advocate for data engineering best practices, including CI/CD, testing, documentation, and code quality.\nMentor data engineers, review code, and help elevate the technical standards across the data team.\n\n\nRequired Qualifications\n\n7+ years of proven experience as a Data Engineer.\nStrong experience designing and maintaining scalable data infrastructures and complex data pipelines.\nExperience in startup or scale-up environments is a must.\nExpertise with SQL and strong understanding of data modeling and warehousing principles.\nHands-on experience with modern data stack tools (e.g., dbt, Airflow, Snowflake, BigQuery, Redshift, Databricks, etc.).\nExperience migrating BI or data tools (e.g., Tableau, Looker, or legacy modern stack).\nSolid understanding of Python for automation, data transformation, or machine learning applications.\nExcellent communication, leadership, and cross-functional collaboration skills.\nProficiency in English (written and spoken).\n\n\nPragmatike is dedicated to a fair, transparent, and inclusive recruitment process. We ensure that no applicant is discriminated against based on age, disability, gender, gender identity or expression, marital or civil partner status, pregnancy or maternity, race, religion or belief, sex, or sexual orientation.\n\nIn accordance with the General Data Protection Regulation (GDPR), your personal data will be processed lawfully, fairly, and securely, and used solely for recruitment purposes, including sharing it with our client(s) for employment consideration. You have the right to request access, correction, or deletion of your data at any time."
  },
  {
    "id": "1885772876",
    "date_posted": "2025-10-13T12:57:05.965",
    "date_created": "2025-10-13T13:06:06.051896",
    "title": "Senior Data Engineer",
    "organization": "Alliance Technical Group",
    "organization_url": "https://www.linkedin.com/company/alliance-technical-group",
    "date_validthrough": null,
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressRegion": "",
          "addressCountry": "",
          "addressLocality": "United States"
        }
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://www.linkedin.com/jobs/view/senior-data-engineer-at-alliance-technical-group-4314135407",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/D560BAQFdCFO14Ao50Q/company-logo_100_100/company-logo_100_100/0/1730390894758/alliance_technical_group_logo?e=2147483647&v=beta&t=hQpuTCmmAA5NaSV4aG5saKdbxBy7MNddmFyNQHL0rMc",
    "cities_derived": null,
    "counties_derived": null,
    "regions_derived": null,
    "countries_derived": [
      "United States"
    ],
    "locations_derived": [
      "United States"
    ],
    "timezones_derived": [
      "America/Chicago"
    ],
    "lats_derived": [
      39.7837304
    ],
    "lngs_derived": [
      -100.445882
    ],
    "remote_derived": false,
    "linkedin_org_employees": 990,
    "linkedin_org_url": "http://www.alliancetg.com",
    "linkedin_org_size": "1,001-5,000 employees",
    "linkedin_org_slogan": "A new kind of environmental services company—powered by innovation, focused on service, and committed to client success.",
    "linkedin_org_industry": "Environmental Services",
    "linkedin_org_followers": 12374,
    "linkedin_org_headquarters": "Decatur, Alabama",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "2000",
    "linkedin_org_specialties": [
      "Stack Testing",
      "Investigative Testing",
      "Compliance Testing",
      "Source Testing",
      "Oil and Gas Analysis",
      "Air Emissions Testing",
      "NSPS",
      "MACT",
      "LDAR",
      "RATA",
      "Environmental Compliance",
      "BWON",
      "OGI",
      "Emissions Monitoring",
      "CEMS",
      "and Environmental Consulting"
    ],
    "linkedin_org_locations": [
      "214 Central Circle SW, Decatur, Alabama 35603, US",
      "15 Maumelle Curve Court, Suite B, Maumelle, Arkansas 72113, US",
      "911 TX-121, Lewisville, Texas, US",
      "24 Hagerty Blvd., Unit 13, West Chester, PA 19382, US",
      "617 Moon Clinton Road, Pittsburgh, PA 15108, US",
      "931 Seaco Court, Deer Park, Texas 77536, US",
      "1355 Sherman Road, Suite 300, Hiawatha, IA 52233, US",
      "3855 S 500 W, Suite A, Salt Lake City, UT 84115, US",
      "5530 Marshall St, Arvada, Colorado, US",
      "5881 Artic Blvd., Suite 104, Anchorage , AK 99518, US"
    ],
    "linkedin_org_description": "Alliance is a new kind of environmental services company—powered by innovation, focused on service, and committed to client success.\n\nSince 2000, we have been solving the problems of environmental management and compliance for some of the foremost companies and brands in North America. From on-site testing and monitoring, to laboratory testing and regulatory strategy, we are pushing out the limits of what is possible. We help our clients achieve their business objectives while also supporting their sustainability goals.\n\nGet solutions for your most important and complex compliance challenges. From on-site assessments and monitoring to laboratory analyses for air, water, soil, and waste—Alliance can help you do it better.",
    "linkedin_org_recruitment_agency_derived": false,
    "seniority": "Not Applicable",
    "directapply": false,
    "linkedin_org_slug": "alliance-technical-group",
    "no_jb_schema": true,
    "external_apply_url": "https://recruiting2.ultipro.com/ALL1037ALNC/JobBoard/281665a5-6db2-4e7a-8885-7900fe799f07/Opportunity/OpportunityDetail?opportunityId=27b156d3-5eb4-417c-a050-7ed0a8a7f9ff",
    "ats_duplicate": false,
    "description_text": "Alliance Technical Group is seeking an experienced Senior Data Engineer to design, build, and optimize the databases and data systems that power our business intelligence and analytics platforms. In this role, you will lead the creation of scalable pipelines, data models, and cloud-based architecture that ensures reliable, high-quality data across the organization.\nShow more Show less"
  },
  {
    "id": "1885771145",
    "date_posted": "2025-10-13T12:50:36.31",
    "date_created": "2025-10-13T13:03:36.398153",
    "title": "Senior Data Engineer (Remote - US)",
    "organization": "Jobgether",
    "organization_url": "https://be.linkedin.com/company/jobgether",
    "date_validthrough": null,
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressRegion": "",
          "addressCountry": "",
          "addressLocality": "United States"
        }
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://www.linkedin.com/jobs/view/senior-data-engineer-remote-us-at-jobgether-4311462072",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/D4E0BAQF0wkBJGVGz4g/company-logo_100_100/B4EZm5iEh.HMAQ-/0/1759754340919/jobgether_logo?e=2147483647&v=beta&t=t66wh9ILvVHuPo0GiWTtmJ91ppiGctkTwlesSwMPCL4",
    "cities_derived": null,
    "counties_derived": null,
    "regions_derived": null,
    "countries_derived": [
      "United States"
    ],
    "locations_derived": [
      "United States"
    ],
    "timezones_derived": [
      "America/Chicago"
    ],
    "lats_derived": [
      39.7837304
    ],
    "lngs_derived": [
      -100.445882
    ],
    "remote_derived": true,
    "linkedin_org_employees": 188,
    "linkedin_org_url": "https://www.jobgether.com",
    "linkedin_org_size": "11-50 employees",
    "linkedin_org_slogan": "The AI-driven global platform to hire and get hired, efficiently. The right talent. The right job. Instantly connected.\n",
    "linkedin_org_industry": "Internet Marketplace Platforms",
    "linkedin_org_followers": null,
    "linkedin_org_headquarters": "Brussels",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "2020",
    "linkedin_org_specialties": [
      ""
    ],
    "linkedin_org_locations": [
      "Brussels, BE"
    ],
    "linkedin_org_description": "Job search is broken. Talents waste hours applying blindly, companies drown in irrelevant CVs.\nJobgether flips the model.\nWe’re an AI-powered career coach and matching platform helping people land remote and flexible jobs faster.\nJobgether designs your job search strategy, prepares you to stand out, and connects you only with roles that truly match.\nFinding a job isn’t about applying to hundreds of listings anymore, it’s about having the right strategy and visibility to attract the right opportunities.\n\nPurpose & Vision\nOur purpose is to make remote job search guided, fast, and effective, reducing frustration and wasted effort for both talents and employers.\nWe envision a world where careers are built with intention, not luck.\nWhere flexibility is the norm.\nWhere no talent remains invisible.\n\nJobgether exists to ensure that every professional has a real chance to find the right remote job.\n",
    "linkedin_org_recruitment_agency_derived": false,
    "seniority": "Mid-Senior level",
    "directapply": true,
    "linkedin_org_slug": "jobgether",
    "no_jb_schema": true,
    "external_apply_url": null,
    "ats_duplicate": null,
    "description_text": "This position is posted by Jobgether on behalf of a partner company. We are currently looking for a Senior Data Engineer in the United States.\n\nIn this role, you will design, develop, and optimize large-scale data pipelines and architectures to ensure reliable, high-quality, and timely data delivery for analytics and reporting. You will work closely with cross-functional teams, including DevSecOps and business intelligence, to implement complex data management solutions, real-time processing applications, and automated workflows. This role provides an opportunity to influence the organization's data strategy, drive efficiency, and implement best practices in data ingestion, transformation, validation, and orchestration. You will mentor junior engineers, provide guidance on technical solutions, and contribute to improving data reliability and performance across multiple environments. The position offers a collaborative, innovative, and flexible work environment with the ability to impact key business decisions through data-driven insights.\n\nAccountabilities:\n\nDevelop and operationalize robust data pipelines, including ingestion, transformation, validation, and orchestration\nDesign, implement, and maintain real-time data processing applications and high-performance data structures\nGuide and mentor data engineers in designing, testing, documenting, and operating scalable data solutions\nEnsure data quality, reliability, and efficiency across the organization's environments\nDevelop and maintain architectures using advanced programming languages and tools\nIdentify automation opportunities and implement solutions to optimize data workflows\nCollaborate with DevSecOps teams during continuous integration and deployment processes\n\n\nRequirements\n\nBachelor's degree in a quantitative or business field (e.g., Statistics, Mathematics, Engineering, Computer Science) or equivalent experience\n4-6 years of related experience in data engineering or similar roles\nStrong experience with ETL processes, SQL, Python, and data pipeline orchestration\nFamiliarity with business intelligence and visualization tools such as Power BI\nKnowledge of data quality practices, large-scale data management, and real-time processing\nStrong analytical, problem-solving, and communication skills\nAbility to work independently and collaboratively in a flexible work environment\n\n\nBenefits\n\nCompetitive salary range: $85,300 - $158,100 per year, adjusted based on skills and experience\nComprehensive health insurance, dental, and vision coverage\n401(k) and employee stock purchase plans\nTuition reimbursement and professional development opportunities\nPaid time off, holidays, and flexible work schedules (remote, hybrid, or office-based)\nInclusive and diverse work environment with opportunities for career growth and mentorship\n\nJobgether is a Talent Matching Platform that partners with companies worldwide to efficiently connect top talent with the right opportunities through AI-driven job matching.\n\nWhen you apply, your profile goes through our AI-powered screening process designed to identify top talent efficiently and fairly.\n\n🔍 Our AI evaluates your CV and LinkedIn profile thoroughly, analyzing your skills, experience, and achievements.\n\n📊 It compares your profile to the job's core requirements and past success factors to determine your match score.\n\n🎯 Based on this analysis, we automatically shortlist the 3 candidates with the highest match to the role.\n\n🧠 When necessary, our human team may perform an additional manual review to ensure no strong profile is missed.\n\nThe process is transparent, skills-based, and free of bias — focusing solely on your fit for the role. Once the shortlist is completed, we share it directly with the company that owns the job opening. The final decision and next steps (such as interviews or additional assessments) are then made by their internal hiring team.\n\nThank you for your interest!\n\nShow more Show less"
  },
  {
    "id": "1885771848",
    "date_posted": "2025-10-13T12:39:24",
    "date_created": "2025-10-13T13:04:34.799916",
    "title": "Junior Data Engineer (Energy Domain)",
    "organization": "Vallum Associates",
    "organization_url": "https://www.linkedin.com/company/vallum-associates-limited",
    "date_validthrough": "2025-11-12T12:39:24",
    "locations_raw": [
      {
        "@type": "Place",
        "address": {
          "@type": "PostalAddress",
          "addressCountry": "GB",
          "addressLocality": "London Area",
          "addressRegion": null,
          "streetAddress": null
        },
        "latitude": 51.51649,
        "longitude": -0.128427
      }
    ],
    "location_type": null,
    "location_requirements_raw": null,
    "salary_raw": null,
    "employment_type": [
      "FULL_TIME"
    ],
    "url": "https://uk.linkedin.com/jobs/view/junior-data-engineer-energy-domain-at-vallum-associates-4314135240",
    "source_type": "jobboard",
    "source": "linkedin",
    "source_domain": "uk.linkedin.com",
    "organization_logo": "https://media.licdn.com/dms/image/v2/D4E0BAQGEaBd1yi1LHQ/company-logo_200_200/company-logo_200_200/0/1730807785665/vallum_associates_limited_logo?e=2147483647&v=beta&t=WiQKuD04iV3LPLTxOQp7dm9PVrEUvsBjPapEpwucjBQ",
    "cities_derived": [
      "London"
    ],
    "counties_derived": [
      "Greater London"
    ],
    "regions_derived": [
      "England"
    ],
    "countries_derived": [
      "United Kingdom"
    ],
    "locations_derived": [
      "London, England, United Kingdom"
    ],
    "timezones_derived": [
      "Europe/London"
    ],
    "lats_derived": [
      51.5074456
    ],
    "lngs_derived": [
      -0.1277653
    ],
    "remote_derived": false,
    "linkedin_org_employees": 58,
    "linkedin_org_url": "https://www.vallumassociates.com/",
    "linkedin_org_size": "11-50 employees",
    "linkedin_org_slogan": "Offering talent acquisition across Energy & Commodities, Financial Services, Renewable & Engineering and Insurance.",
    "linkedin_org_industry": "Staffing and Recruiting",
    "linkedin_org_followers": 214307,
    "linkedin_org_headquarters": "London, England",
    "linkedin_org_type": "Privately Held",
    "linkedin_org_foundeddate": "2015",
    "linkedin_org_specialties": [
      "Recruitment",
      "coaching",
      "business coaching",
      "IT",
      "Cloud",
      "transformation",
      "change",
      "AI",
      "data",
      "digital",
      "automation",
      "Renewable Energy",
      "Energy",
      "Energy and Utilities",
      "Utilities",
      "Insurance",
      "Engineering",
      "Solar",
      "Trading",
      "Staffing",
      "and Recruiting"
    ],
    "linkedin_org_locations": [
      "10 Lower Thames Street, London, England EC3R 6AF, GB",
      "501 Boylston St, Boston, Massachusetts 02116, US"
    ],
    "linkedin_org_description": "Vallum Associates offer best in class talent acquisition on a contingency, retained, or project basis. Through our dedicated sector consultants, our specialised brands have the knowledge and connections to provide tailored hiring and project services across industries:\n\n•\tEnergy and Utilities\n•\tEngineering and Renewables\n•\tInsurance\n•\tTechnology\n•\tMEP/FP Engineering\n•\tCommodities and Financial Services\n\nOur specialised industry and sector specific consultants are able to offer a personalised experience to fit your needs. Our unique associate consultative approach compliments our own consultant’s in-depth industry knowledge, allowing us to draw upon industry-wide connections to offer non- traditional approaches to delivering transformation and complete business growth globally.\n",
    "linkedin_org_recruitment_agency_derived": true,
    "seniority": "Associate",
    "directapply": true,
    "linkedin_org_slug": "vallum-associates-limited",
    "no_jb_schema": null,
    "external_apply_url": null,
    "ats_duplicate": null,
    "description_text": "Energy Domain is a must.\nUnder 7 years of experience only.\nPermanent.\n\nKey Responsibilities\nDesign, develop, and maintain data ingestion pipelines using open-source frameworks and tools\nBuild and optimise ETL/ELT processes to handle small to large-scale data processing requirements\nDevelop data models and schemas that support analytics, business intelligence and product needs\nMonitor, troubleshoot, and optimise data pipeline performance and reliability\nCollaborate with stakeholders, analysts and product team to understand data requirements\nImplement data quality checks and validation processes to ensure data integrity\nParticipate in architecture decisions and contribute to technical roadmap planning\n\nTechnical Skills:\nGreat SQL skills with experience in complex query optimization\nStrong Python programming skills with experience in data processing libraries (pandas, NumPy, Apache Spark)\nHands-on experience building and maintaining data ingestion pipelines\nProven track record of optimising queries, code, and system performance\nExperience with open-source data processing frameworks (Apache Spark, Apache Kafka, Apache Airflow)\nKnowledge of distributed computing concepts and big data technologies\nExperience with version control systems (Git) and CI/CD practices\nExperience with relational databases (PostgreSQL, MySQL or similar)\nExperience with containerization technologies (Docker, Kubernetes)\nExperience with data orchestration tools (Apache Airflow or Dagster)\nUnderstanding of data warehousing concepts and dimensional modelling\nUnderstanding of cloud platforms using infrastructure-as-code (IaC) approaches\nKnowledge of streaming data processing and real-time analytics\nExperience with data quality and monitoring tools\n\nPreferred Qualifications:\nBachelor's degree in Computer Science, Engineering, Mathematics, or related field\n2-5 years of experience in data engineering or related roles\nExperience working in the Energy industry"
  }
]


Additional info

API Overview

High quality job listings from LinkedIn. Includes all relevant details like: Full job description, Company industry, number of followers, location, specialties, company description.

Our database indexes over 20,000 jobs every hour and contains jobs from the last 7 days. Over 2 million jobs every week! Each API call returns up to 100 jobs.

We offer a wide range of filters to narrow the results down: Job Title, Description, Location, Company, Remote.

8M+ AI-enriched LinkedIn jobs with Apply URL + Company info & Hourly refresh. Powered by Fantastic.jobs

Do you wish to retrieve jobs beyond the limits of this API? Please reach out to remco@fantastic.jobs for any custom requests.

This API makes no representations or warranties of any kind, express or implied, that it is in any way an official LinkedIn API.

This API contains publicaly available LinkedIn Job Posting Data, no member pages are scraped or indexed for the purpose of this API.
✨ Explore Our Other Job APIs
🚀 Fantastic.jobs API Overview

Jobs from career sites, job boards, freelance platforms, and more!
About this API

This API is designed for job platforms requiring high quality LinkedIn job listings.

This API returns up to 100 jobs per request for all endpoints except the 6-month endpoint, which returns up to 500 jobs

You may reduce the number of jobs per request by using the limit parameter. Each plan has plenty of requests to support strategies with a lower number of jobs per API call. If you omit the limit parameter, the limit defaults to 100 jobs per request (500 for 6m).
Job Credits & Request Credits

    Each request deducts the number of jobs returned from your "Jobs" credits.
    Each request deducts 1 credit from your "Requests" credits.
    Your "Jobs" credits should run out before your "Requests" credits. This is by design.
    If you have any question or require more than 200,000 jobs per month, please reach out to us at remco@fantastic.jobs

Tracking your Credit usage

There are two ways to keep track of your credits:

    Each API request returns several headers, showing your how many credits you have left for Jobs and Requests: For example:

x-ratelimit-jobs-limit: 200000
x-ratelimit-jobs-remaining: 199234
x-ratelimit-requests-limit: 25000
x-ratelimit-requests-remaining: 24975

In addition, there's a header to track the time left in your plan (reset date), in seconds:

x-ratelimit-jobs-reset: 2505077

    You can also track your usage on the Subscription & Usage page: https://rapidapi.com/developer/billing/subscriptions-and-usage

Important:

To prevent retrieving duplicate jobs, we encourage using the following strategy:

    Call the API on a regular schedule:

Get Jobs 7 days: Call the API on the same time and day every week

Get Jobs 24h: Call the API on the same time every day.

Get Jobs 1h: Call the API on the same time every hour

Doing so will ensure that you will not retrieve the same jobs twice. Please note that these endpoints will return jobs that we discovered within the timeframe. The jobs might have date_posted outside of this timeframe. Use date_filter to ensure that you only receive jobs with date_posted within a certain timeframe

    Most of our filters allow you to combine keywords, do this as much as possible. For example, you may search multiple locations using location_filter="United States" OR "United Kingdom".

    If you're ever in doubt, please reach out to remco@fantastic.jobs

Endpoints
Get Jobs 24h:

Contains LinkedIn jobs indexed during the last 24h. This can be jobs older than 24h. For example: jobs that have been re-posted
Get Jobs 7 days:

Contains active LinkedIn jobs that were indxed during the last 7 days. This can be jobs older than 7 days. For example jobs that have been reposted
Get Jobs 6m:

Contains active LinkedIn jobs that were posted during the last 6 months. Plese note that we don't track reposts, so some of our jobs might have and older 'date_posted' value.

Expired jobs are removed every hour from this endpoint. We check every job once per day.
Get Jobs Hourly - (Ultra & Mega plan)

Firehose API containing jobs indexed during the last hour (with a 2 hour delay). Perfect for one or more hourly API calls to get the freshest jobs!
Get Expired Jobs - (Ultra & Mega plan)

API containing IDs of jobs flagged as expired the day before. Updates once per day and contains an array of all ID's. Please note that this array contains 300,000 + ID's per request.

This endpoint does not count towards your "Jobs" credits!
The data

    This API calls a database that includes LinkedIn jobs posted during the last hour, 24h, 7 days, or 6 months.

    The API refreshes every hour with a delay of one to two hours. For example, if a job is posted at 06:00 UTC, it will appear between 07:00 and 08:00 UTC

    The 6m endpoint is an except and gets refreshed every minute with a delay for enrichment of about 45 minutes

    We index LinkedIn jobs from over 100 countries.

    All jobs in the database are unique based on their URL. However, organizations occasionally create duplicates themselves. More commonly, organizations sometimes create the same job listing for multiple cities or states. If you wish to create a rich and unique dataset, we recommend further deduplication on title + organization, or title + organization + locations

    We're testing AI enrichment for non-agency jobs by extracting useful job details from the description with an LLM. Please see below for more information

Search

Our database can be searched with the following syntax:

Job searches are limited to 100 jobs per API call (500 for 6m). You can easily extend your search by using the 'offset' parameter.

title_filter

Our filters are similar to searching on google:
Query	Result
Software	All jobs including software in the job title
Software Engineer	All jobs including 'software' AND 'engineer' in the job title
"Software Engineer"	All jobs including 'software' AND 'engineer' in order in the job title
Software OR Engineer	All jobs including 'software' OR 'engineer' in the job title
-"Software Engineer"	All jobs excluding 'software' AND 'engineer' in order in the job title

For advanced filtering, including parenthesis and prefix wildcard searching, please use the advanced_title_filter. Documentation can be found at the bottom of this page

Advanced Title Filter

Advanced Title filter enables more features like parenthesis, 'AND', and prefix searching.

Can't be used in combination with regular title_filter

Phrares (two words or more) always need to be single quoted or use the operator <->

Instead of using natural language like 'OR' you need to use operators like:

    & (AND)
    | (OR)
    ! (NOT)
    <-> (FOLLOWED BY)
    ' ' (FOLLOWED BY alternative, does not work with 6. Prefix Wildcard)
    :* (Prefix Wildcard)

For example:

(AI | 'Machine Learning' | 'Robotics') & ! Marketing

Will return all jobs with ai, or machine learning, or robotics in the title except titles with marketing

Project <-> Manag:*

Will return jobs like Project Manager or Project Management

Please send us a message if you're getting errors

location_filter

You can use the same syntax as title_filter for searches on Location. Please make sure to search on the full name of the location, abbreviations are not supported.

    For US, please search on United States
    For UK, please search on United Kingdom
    For states in the United States, please search on their full name, like "New York, United States"
    For Cities in the UK, please include England, Wales, Scotland, Northern Ireland. For example: "Birmingham, England, United Kingdom"

For example: location_filter="United States" OR "United Kingdom"

description_filter (Does not work for 6m)

You can use the same syntax as title_filter for description_filter.

Warning, when using description_filter for the 7 day endpoint there's a risk of timeouts. We recommend using the description_filter with the 24h or Hourly endpoints.

If you do want to use it for the 7 day endpoint:

    Avoid double quoting common keywords like "health safety"
    Stick to a low limit, prefereably 10
    Stick to a low offset

organization_description_filter (Does not work for 6m)

Filter on the job's organization LinkedIn description. You can use the same syntax as title_filter

organization_specialties_filter (Does not work for 6m)

Filter on the job's organization LinkedIn specialties. You can use the same syntax as title_filter Please note that not all organiaztions have specialties

organization_slug_filter

Filter on the job's company via the slug. You can search on more than one company with a comma delimited list without spaces!. For example: organization_filter:microsoft,tesla-motors

Only allows for exact matches, please check the exact company slug before filtering.

The slug is the company specific part of the url. For example the slug in the following url is 'tesla-motors': https://www.linkedin.com/company/tesla-motors/

type_filter

Filter on a specific job type, the options are: CONTRACTOR, FULL_TIME, INTERN, OTHER, PART_TIME, TEMPORARY, VOLUNTEER

To filter on more than one job type, please delimit by comma with no space, like such: FULL_TIME,PART_TIME

industry_filter

Filter on the organization's LinkedIn Industry.

Please use the exact Industry. This filter is case sensitive.

All industries are now in English You can find an overview of all LinkedIn industries on our website

If the industry contains a comma, please double-quote. For Example: industry_filter:"Air, Water, and Waste Program Management","Accounting"

You can filter on more than one industry with a comma delimited list without spaces. For example: industry_filter=Accounting,Staffing and Recruiting

seniority_filter

Filter on the seniority level as described on the LinkedIn jobs page.

Please use the exact seniorty description. This filter is case sensitive.

Please note that certain languages might not use the English description. We recommend use both the English and any foreign language seniority descriptions

You can filter on more than one seniority description with a comma delimited list without spaces. For example: seniority_filter=Mid-Senior level,Entry level

For English, you can use the following filters. Please note that these might change so we recommend regularly checking these: Associate, Director, Executive, Mid-Senior level, Entry level, Not Applicable, Internship

Due to employers using 'Not Applicable' regularly, we recommend only using this filter when you're happy with missing out on some jobs that might be relevant.

description_type

You may optionally include the job description in the output.

    Option 1 'text': A plain text version of the HTML description. Might include /n breaks
    Option 2 'html': A HTML version of the description, perfect for job boards.

Make sure you understand the risk of adding HTML to your website, we don't modify any of the indexed HTML data!

remote

Set to 'true' to include remote jobs only. Set to 'false' to include jobs that are not remote. Leave empty to include both remote and non remote jobs

This is a derived field. We identify remote jobs by title, raw location fields, and the offical google jobs 'TELECOMMUTE' schema

agency

Use this to filter or filter-out recruitment agencies and job boards: TRUE = only recruitment agencies and job boards FALSE= only regular companies.

Please send us a message if you notice any organizations with the wrong flag.

offset

Offset allows you to paginate and include more results. For example, if you want to retrieve 30 jobs from our api you can send 3 requests with offset 0, 10, and 20. This is always a multiple of the 'limit' parameter

date_filter

You can use this filter to return only the most recent jobs, instead of all jobs from the last 7 days. This filter is a "greater than" filter. For example, if today's date is 2025-01-03 and you wish to only return jobs posted in 2025, you can filter on '2025-01-01'.

To include time, use the following syntax: '2025-01-01T14:00:00'

Please keep in mind that the jobs posted date/time is UTC and there's a 1 to 2 hour delay before jobs appear on this API.

exclude_ats_duplicate

Set this parameter to true to remove the majority of duplicate jobs between this API and the 'Active Jobs DB' API. Please see the documentation for details

This is not a general deduplication parameter, do not use this if you don't use the 'Active Jobs DB' API

We have created a system where every LinkedIn job is checked against the ATS dataset. This system will perform 3 checks for every LinkedIn job:

    A (cleaned) URL match
    A match of job title + organization name
    A match of job title + LinkedIn company profile mapping

If any of these 3 have a hit, the LinkedIn job will be flagged as ats_duplicate=true in the API output. If none of these 3 have a hit, the LinkedIn job will be flagged as ats_duplicate=false

Some jobs are not checked; these are jobs that originate from agencies/jobboards (linkedin_org_recruitment_agency_derived=true) or jobs with LinkedIn EasyApply (directapply=true). These jobs will be flagged as ats_duplicate=null

We are hoping to flag the majority of duplicates in the datasets, but we are looking for exact hits only. This means that there will still be a number of false positives slipping through the cracks. To fully eliminate duplicates between the two datasets, we recommend adding a layer of fuzzy deduplication.

external_apply_url

Set to True to include only jobs with an external_apply_url.

The url's are not cleaned and might include trackers like source=linkedin, utm tags, etc

this parameter is the opposite of directapply

directapply (easyapply)

Set to True to only include jobs with directapply (easyapply). Set to false to exclude jobs with directapply.

This field is very complimentary to our ATS API. Jobs with easyapply have almost no overlap with ATS jobs.

this parameter is the opposite of exernal_apply_url

employees_lte

Use this to filter on jobs from companies less than a certain number of employees. Can be used in combination with employees_gte. For example, if you wish to filter on small companies but want to exclude companies with just one employee, you can use the following query filter: employees_gte=1 employees_lte=200

employees_gte

Use this to filter on jobs from companies greater than a certain number of employees. Can be used in combination with employees_lte. For example, if you wish to filter on small companies but want to exclude companies with just one employee, you can use the following query filter: employees_gte=1 employees_lte=200

order The order of the jobs is date descending by default, if you wish to order on date ascending, please use 'asc'

include_ai

BETA Feature

We're now extracting useful insights from the job description with AI. Includes Salary, Benefits, Experience Level, Detailed Remote filters, and more. Please see the table below for all fields.

Set this field to true to include all AI-enriched fields.

AI enrichment is only performed on roles listed by companies. Jobs listed by recruitment/staffing agencies and other 3rd parties are not included.

Do you see a repeated mistake in the output? Please report here

ai_work_arrangement_filter

BETA Feature.

Filter on a specific work arrangement identified by our AI, This is a more granular version of the 'remote' filter, which is quite broad the options are:

    On-site (Job is on site only, no working from home available)
    Hybrid (Job is in the office with one or more days remote)
    Remote OK (Job is fully remote, but an office is available)
    Remote Solely (Job is fully remote, and no office is available)

To filter on more than one job type, please delimit by comma with no space, like such: Hybrid,Remote OK,Remote Solely

ai_taxonomies_a_filter

Filter the jobs on one or more top level taxonomies. You can choose from: Technology, Healthcare, Management & Leadership, Finance & Accounting, Human Resources, Sales, Marketing, Customer Service & Support, Education, Legal, Engineering, Science & Research, Trades, Construction, Manufacturing, Logistics, Creative & Media, Hospitality, Environmental & Sustainability, Retail, Data & Analytics, Software, Energy, Agriculture, Social Services, Administrative, Government & Public Sector, Art & Design, Food & Beverage, Transportation, Consulting, Sports & Recreation, Security & Safety

You can filter on more than one taxonomy with a comma delimited list without spaces!. For example: ai_taxonomies_a_filter:Technology,Healthcare

Taxonomies are broadly applied and ordered on relevance

ai_taxonomies_a_exclusion_filter

Use this parameter to exclude jobs with certain top level taxonomies from the results

You can filter out more than one taxonomy with a comma delimited list without spaces!. For example: ai_taxonomies_a_exclusion_filter:Technology,Healthcare

ai_has_salary

BETA Feature.

Set to 'true' to only include jobs with a salary, either listed in salary_raw or extracted from the job description with AI. Please set include_ai=true when using this field

ai_experience_level_filter

BETA Feature.

Filter on a certain required experience level as identified by our AI, the options are:

0-2/2-5/5-10/10+

To filter on more than one job type, please delimit by comma with no space, like such: 0-2,2-5

ai_visa_sponsorship_filter

BETA Feature.

Filter on jobs that mention Visa sponsorship within the job description.

Output

Jobs are ordered on 'dateposted' ascending. Resulting in the most recent jobs being first in the array.
Output Fields
Name	Description	Type
id	Our internal ID. We don't recommend this for sorting	Int8
title	Job Title	text
organization	Name of the hiring organization	text
organization_url	URL to the organization's LI page	text
organization_logo	URL to the organization's logo	text
date_posted	Date & Time of posting	timestamptz
date_created	Date & Time of indexing in our systems	timestamptz
date_validthrough	Date & Time of expiration, is null in most cases	timestamptz
locations_raw	Raw location data, per the Google for Jobs requirements	json[]
locations_derived	Derived location data, which is the raw data matched with a database of locations_raw or location_requirements_raw. This is the field where you search locations on.	text[] [{city, admin (state), country}]
location_type	To identify remote jobs: 'TELECOMMUTE' per the Google for Jobs requirements	text
location_requirements_raw	Location requirement to accompany remote (TELECOMMUTE) jobs per the Google for Jobs requirements.	json[]
salary_raw	raw Salary data per the Google for Jobs requirements	json
employment_type	Types like 'Full Time", "Contract", "Internship" etc. Is an array but most commonly just a single value.	text[]
url	The URL of the job, can be used to direct traffic to apply for the job	text
source	in this case 'linkedin'	text
source_type	in this case 'jobboard'	text
source_domain	this domain can help you ID the country from where the job was posted. linkedin.com is the US, uk.linkedin.com the uk etc.	text
description_text	plain text job description - if included	text
cities_derived	All cities from locations_derived	json[]
regions_derived	All regions/states/provinces from locations_derived	json[]
countries_derived	All countries from locations_derived	json[]
timezones_derived	Timezones derived from locations_derived	json[]
lats_derived	lats derived from locations_derived	json[]
lngs_derived	lngs derived from locations_derived	json[]
remote_derived	jobs flagged as remote, by title, raw location, and the offical google jobs 'TELECOMMUTE' schema	bool
seniority	Seniority level: Associate, Director, Executive, Mid-Senior level, Entry level, Not Applicable, Internship	text
directapply	'true' if the end user can apply directly on the job page, in this case LinkedIn "easyapply". False if the job contains a link to a 3rd party	bool
linkedin_org_employees	the number of employess within the job's company according to LI	int
linkedin_org_url	url to the company page	text
linkedin_org_size	the number of employess within the job's company according to the company	text
linkedin_org_slogan	the company's slogan	text
linkedin_org_industry	the company's industry. This is a fixed list that the company can choose from, so could be useful for classification.	text
linkedin_org_followers	the company's followers on LI	int
linkedin_org_headquarters	the company's HQ location	text
linkedin_org_type	the company's type, like 'privately held', 'public', etc	text
linkedin_org_foundeddate	the company's founded date	text
linkedin_org_specialties	a comma delimited list of the company's specialites	text[]
linkedin_org_locations	the full address of the company's locations	text[]
linkedin_org_description	the description fo the company's linkedin page	text
linkedin_org_recruitment_agency_derived	If the company is a recruitment agency, true or false. We identify this for each company using an LLM. The accuracy may value and jobboards might be flagged as false.	bool
linkedin_org_slug	The slug is the company specific part of the url. For example the slug in the following url is 'tesla-motors': https://www.linkedin.com/company/tesla-motors/	text
AI Output Fields

BETA Feature

AI enrichment is enabled for non-agency roles. Recruitment agencies are excluded.

Set include_ai to true to include the fields in this table These fields are derived from the text with an LLM and might contain mistakes.
Name	Description	Type
ai_salary_currency	The salary currency	text
ai_salary_value	The salary value, if there's a single salary with no salary range	numeric
ai_salary_minvalue	The salary minimum salary in a range	numeric
ai_salary_maxvalue	The salary maximum salary in a range	numeric
ai_salary_unittext	If the salary is per HOUR/DAY/WEEK/MONTH/YEAR	text
ai_benefits	An array with other non-salary benefits mentioned in the job listing	text[]
ai_experience_level	years of experience required, one of: 0-2, 2-5, 5-10, or 10+	text
ai_work_arrangement	Remote Solely/Remote OK/Hybrid/On-site. Remote solely is remote without an office available, Remote OK is remote with an optional office.	text
ai_work_arrangement_office_days	when work_arrangement is Hybrid, returns the number of days per week in office	bigint
ai_remote_location	When remote but only in a certain location, returns the location	text[]
ai_remote_location_derived	Derived remote location data, which is the raw data (ai_remote_location) matched with a database of locations. This is the same database as the locations_derived field.	text[]
ai_key_skills	An array of key skills mentioned in the job listing	text[]
ai_core_responsibilities	A 2-sentence summary of the job's core responsibilities	text
ai_requirements_summary	A 2-sentence summary of the job's requirements	text
ai_working_hours	The number of required working hours. Defaults to 40 if not mentioned	bigint
ai_employment_type	One or more employment types as derived from the job description: FULL_TIME/PART_TIME/CONTRACTOR/TEMPORARY/INTERN/VOLUNTEER/PER_DIEM/OTHER	text[]
ai_job_language	The language of the job description	text
ai_visa_sponsorship	Returns true if the job description mentions Visa sponsorship opportunities	boolean
Provider Info

API creator
Fantastic.Jobs thumbnail
by Fantastic.Jobs

subscribers

10671

subs

category
Jobs

resources
Product Website

---

## Vendor 2: JSearch (OpenWeb Ninja)

Endpoint https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/playground/endpoint_f2b4c6e5-2763-450a-a8b2-1e80961e880d

Query Params
query
*
String

Free-form jobs search query. It is highly recommended to include job title and location as part of the query, see query examples below.

Examples:

    web development jobs in chicago
    marketing manager in new york via linkedin

page
(optional)
Number

Page to return (each page includes up to 10 results).

Default: 1

Allowed values: 1-50
Default: 1
num_pages
(optional)
Number

Number of pages to return, starting from page.

Default: 1

Allowed values: 1-50

Note: Each page (containing up to 10 results) returned by the API consumes one request credit.
Default: 1
country
(optional)
String

Country code of the country from which to return job postings. Please note that this parameter must be set in order to get jobs in a specific country, for example, to query for software developer jobs in Berlin, one should add country=de to the request - e.g. query=software+developers+in+berlin&country=de.

Default: us

Allowed values: See https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2
language
(optional)
String

Language code in which to return job postings. Leave empty to use the primary language in the specified country (country parameter).

Note that each country supports certain languages. In case a language not supported by the specified country is used, it is likely that no results will be returned.

Allowed values: See https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes
location
(optional)
String

The location from which the search is made (Google's UULE parameter) - e.g., New York, United State.
date_posted
(optional)
all
Enum

Find jobs posted within the time you specify.

Default: all

Allowed values: all, today, 3days, week, month
work_from_home
(optional)
rapid_do_not_include_in_request_key
Boolean

Only return work from home / remote jobs.

Default: false
employment_types
(optional)
String

Find jobs of particular employment types, specified as a comma delimited list of the following values: FULLTIME, CONTRACTOR, PARTTIME, INTERN.
job_requirements
(optional)
String

Find jobs with specific requirements, specified as a comma delimited list of the following values: under_3_years_experience, more_than_3_years_experience, no_experience, no_degree.
radius
(optional)
Number

Return jobs within a certain distance from location as specified as part of the query (in km). This internally sent as the Google lrad parameter and although it might affect the results, it is not strictly followed by Google for Jobs.
exclude_job_publishers
(optional)
String

Exclude jobs published by specific publishers, specified as a comma (,) separated list of publishers to exclude.

Example: BeeBe,Dice
fields
(optional)
String

A comma separated list of job fields to include in the response (field projection). By default all fields are returned.


Request sample

curl --request GET \
	--url 'https://jsearch.p.rapidapi.com/search?query=developer%20jobs%20in%20chicago&page=1&num_pages=1&country=us&date_posted=all' \
	--header 'Content-Type: application/json' \
	--header 'x-rapidapi-host: jsearch.p.rapidapi.com' \
	--header 'x-rapidapi-key: 9b0725c2e9msh6c0a57e70635d21p15cc9djsnf9695d4ec3e7'


response json example

{
  "status": "OK",
  "request_id": "7a801f69-6f09-4632-b4c7-6f82f836e911",
  "parameters": {
    "query": "developer jobs in chicago",
    "page": 1,
    "num_pages": 1,
    "date_posted": "all",
    "country": "us",
    "language": "en"
  },
  "data": [
    {
      "job_id": "VnVsqdlLW-S4XAiNAAAAAA==",
      "employer_name": "United Airlines",
      "employer_logo": null,
      "employer_website": "https://www.united.com",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "United Airlines Jobs",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Software Developer",
      "job_apply_link": "https://careers.united.com/us/en/job/WHQ00024224/Software-Developer?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "United Airlines Jobs",
          "apply_link": "https://careers.united.com/us/en/job/WHQ00024224/Software-Developer?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Indeed",
          "apply_link": "https://www.indeed.com/viewjob?jk=f9f3e24699cc8d63&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Dice.com",
          "apply_link": "https://www.dice.com/job-detail/41e3f2e4-d2fd-47ee-aef5-b3ed0c75b31c?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/software-developer-at-united-airlines-4027614589?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "OPTnation",
          "apply_link": "https://www.optnation.com/software-developer-job-in-chicago-il-view-jobid-34184?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Jooble",
          "apply_link": "https://jooble.org/jdp/-3363270440742672894?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Adzuna",
          "apply_link": "https://www.adzuna.com/details/4804695397?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "SitePoint",
          "apply_link": "https://www.sitepoint.com/jobs-for-developers/skillstorm/software-developer-793518/?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "Description\n\nThere’s never been a more exciting time to join United Airlines. We’re on a path towards becoming the best airline in the history of aviation. Our shared purpose – Connecting People, Uniting the World – is about more than getting people from one place to another. It also means that as a global company that operates in hundreds of locations around the world with millions of customers and tens of thousands of employees, we have a unique responsibility to uplift and provide opportunities in the places where we work, live and fly, and we can only do that with a truly diverse and inclusive workforce. And we’re growing – in the years ahead, we’ll hire tens of thousands of people across every area of the airline. Our careers include a competitive benefits package aimed at keeping you happy, healthy and well-traveled. From employee-run \"Business Resource Group\" communities to world-class benefits like parental leave, 401k and privileges like space available travel, United is truly a one-of-a-kind place to work. Are you ready to travel the world?\n\nWe believe that inclusion propels innovation and is the foundation of all that we do. United's Digital Technology team spans the globe and is made up of diverse individuals all working together with cutting-edge technology to build the best airline in the history of aviation. Our team designs, develops and maintains massively scaling technology solutions brought to life with innovative architectures, data analytics, and digital solutions.\n\nKey Responsibilities:\n\nUnited's Revenue Management team is growing and we are seeking a Software Developer to come join us! The Software Developer plays an important role in creating and maintaining the strategic partnership between business needs and technology delivery. The Developer's role is to plan, design, develop and launch efficient systems and solutions in support of core organizational functions.\n\nThis individual will utilize effective communication, analytical, and problem-solving skills to help identify, communicate / resolve issues, opportunities, or problems to maximize the benefit of IT and Business investments. The Developer is experienced and self - sufficient in performing their responsibilities requiring little supervision, but general guidance and direction.\n\nThis is a hybrid role at United’s headquarters based in Chicago Office, Willis Tower.\n• Assist in design, develop and modify software applications/systems\n• Collaborates with cross-functional teams to understand business requirements and deliver solutions\n• Provides support to the software development leads (Ex: Senior Developer)\n• Works on one or more moderate to complex projects\n• Applies security code best practices throughout development cycle\n• Contributes to software documentation and user manuals\n• Complete comprehensive unit testing on all developed/enhanced software and supports deployment of software application\n• Participates in code reviews to ensure code adheres to standards\n• Support and troubleshoot software systems as required, optimizing performance, resolving problems, and providing follow-up on all issues and solutions\n• Stays up to date on the latest industry trends and technology\n\nUnited values diverse experiences, perspectives, and we encourage everyone who meets the minimum qualifications to apply. While having the “desired” qualifications make for a stronger candidate, we encourage applicants who may not feel they check ALL of those boxes! We are always looking for individuals who will bring something new to the table!\n\nQualifications\n\nWhat’s needed to succeed (Minimum Qualifications):\n• Bachelor's degree in Computer science, software engineering, or related field\n• 3+ years of experience in a similar role\n• Proficient in a coding language and building back-end components\n• Problem solving\n• Attention to detail\n• Effective Communication (verbal + written)\n• Demonstrates and eagerness to learn\n• Demonstrate advanced knowledge of SDLC processes, inputs/outputs, standards and best practices\n• Demonstrate advance knowledge of development methodologies, software design and design patterns\n• Demonstrate advance knowledge of the application of development domain areas and specific technologies and tool set\n• Must be legally authorized to work in the United States for any employer without sponsorship\n• Successful completion of interview required to meet job qualification\n• Reliable, punctual attendance is an essential function of the position\n\nWhat will help you propel from the pack (Preferred Qualifications):\n• Cloud technologies (i.e., Azure, AWS)\n• Exposure to APPD & Dynatrace\n• Agile Methodologies\n• .Net, C, C++, C#, Java\n• HTML, Java Script (Angular 2.0, JS), CSS\n• SQL, Oracle Experience, Relational DB Experience\n• Code Repositories like TFS\n• Microsoft Office tools, PowerPoint, Excel\n• Chef/Ansible, Configuration tools\n• Dev Ops Experience\n• Infrastructure knowledge\n• Windows Server 2012\n• UI Analytics (Google Analytics)\n• Continuous Integration & Continuous Deployment\n• Mobile Technologies\n• Exposure to Couchbase NoSQL D\n\nUnited Airlines is an equal opportunity employer. United Airlines recruits, employs, trains, compensates and promotes regardless of race, religion, color, national origin, gender identity, sexual orientation, physical ability, age, veteran status and other protected status as required by applicable law. We will ensure that individuals with disabilities are provided reasonable accommodation to participate in the job application or interview process, to perform crucial job functions. Please contact JobAccommodations@united.com to request accommodation.\n\nEqual Opportunity Employer - Minorities/Women/Veterans/Disabled/LGBT",
      "job_is_remote": false,
      "job_posted_human_readable": "1 day ago",
      "job_posted_at_timestamp": 1732492800,
      "job_posted_at_datetime_utc": "2024-11-25T00:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": [
        "health_insurance"
      ],
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DVnVsqdlLW-S4XAiNAAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Bachelor's degree in Computer science, software engineering, or related field",
          "3+ years of experience in a similar role",
          "Proficient in a coding language and building back-end components",
          "Problem solving",
          "Attention to detail",
          "Effective Communication (verbal + written)",
          "Demonstrates and eagerness to learn",
          "Demonstrate advanced knowledge of SDLC processes, inputs/outputs, standards and best practices",
          "Demonstrate advance knowledge of development methodologies, software design and design patterns",
          "Demonstrate advance knowledge of the application of development domain areas and specific technologies and tool set",
          "Must be legally authorized to work in the United States for any employer without sponsorship",
          "Successful completion of interview required to meet job qualification",
          "Reliable, punctual attendance is an essential function of the position"
        ],
        "Responsibilities": [
          "The Software Developer plays an important role in creating and maintaining the strategic partnership between business needs and technology delivery",
          "The Developer's role is to plan, design, develop and launch efficient systems and solutions in support of core organizational functions",
          "This individual will utilize effective communication, analytical, and problem-solving skills to help identify, communicate / resolve issues, opportunities, or problems to maximize the benefit of IT and Business investments",
          "The Developer is experienced and self - sufficient in performing their responsibilities requiring little supervision, but general guidance and direction",
          "This is a hybrid role at United’s headquarters based in Chicago Office, Willis Tower",
          "Assist in design, develop and modify software applications/systems",
          "Collaborates with cross-functional teams to understand business requirements and deliver solutions",
          "Provides support to the software development leads (Ex: Senior Developer)",
          "Works on one or more moderate to complex projects",
          "Applies security code best practices throughout development cycle",
          "Contributes to software documentation and user manuals",
          "Complete comprehensive unit testing on all developed/enhanced software and supports deployment of software application",
          "Participates in code reviews to ensure code adheres to standards",
          "Support and troubleshoot software systems as required, optimizing performance, resolving problems, and providing follow-up on all issues and solutions",
          "Stays up to date on the latest industry trends and technology"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "vkjeB63QCA2uyqZ3AAAAAA==",
      "employer_name": "Phoenix Recruitment",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQoiRex6jj6ikQceZCw2f9_uX5UCmcjUafRMEPP&s=0",
      "employer_website": "https://www.phoenixsearch.com",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "LinkedIn",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Mid-Level Front-End Developer",
      "job_apply_link": "https://www.linkedin.com/jobs/view/mid-level-front-end-developer-at-phoenix-recruitment-4084597597?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/mid-level-front-end-developer-at-phoenix-recruitment-4084597597?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Huzzle",
          "apply_link": "https://www.huzzle.app/jobs/mid-level-front-end-developer-167568?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Epicareer",
          "apply_link": "https://us.epicareer.com/job/24054623-mid-level-front-end-ui-mvc-developer?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "This is a remote position.\n\nMid-Level Front-End Developer - US Only\n\nExperience: 3+ years\n\nEmployment Type: Full-time, Remote\n\nBase Salary: $85K-$95K\n\nPhoenix Recruitment offers a variety of recruiting services to assist both employers and employees. They are specialized in marketing open positions, recruiting, and helping employers to find qualified candidates across various industries. Phoenix Recruitment has expertise in streamlining the hiring process. They can help ensure that the process is efficient, well organized, and compliant with relevant regulations.\n\nDescription:\n\nThe Front-End Developer is responsible for building the client side of our web applications. The Front-End Developer will translate our company and customer needs into functional and appealing interactive applications.\n\nEssential Functions and Responsibilities:\n• Create user-friendly web pages\n• Maintain and improve website\n• Optimize applications for maximum speed\n• Design mobile-based features\n• Collaborate with back-end developers and web designers to improve usability\n• Get feedback from, and build solutions for users and customers\n• Adhere to the Code of Conduct and all Company Policies and Procedures.\n\nEducation and Experience:\n• 5+ years of experience as a Front-end Developer.\n• Hands-on experience with markup languages.\n• Familiarity with browser testing and debugging. In-depth understanding of the entire web development process (design, development, and deployment).\n• The ability to perform well in a fast-paced environment.\n• BSc degree in Computer Science or relevant field preferred, however, a combination of education and experience will be considered.\n• Strong communication skills to collaborate with cross-functional teams and explain technical concepts to non-technical stakeholders.\n• Positive and professional approach at all times.\n• Ability to work independently as well as part of a team. Strong attention to detail.\n• Experience with Selenium, jQuery, FHIR API, SFTP, Stripes framework, and YouTrack a strong plus.\n• Experience with and proficiency in using Spring framework (DI, IoC), HL7 v2.x spec – HAPI API, SQL –basis (abatis) / mMySQL OOD/OOP – Design patterns, REST API, Repository – git, svn, Bug tracker/issue tracking system, and IDE (Eclipse, STS, IntelliJ) preferred.\n\nWhy Phoenix Recruitment LLC?\n\nPhoenix Recruitment often has an extensive network of employers and candidates. This network allows them to tap into a pool of qualified candidates and connect them with suitable job opportunities. They can also leverage their connections to help employers find the right talent efficiently. Outsourcing the recruitment process to a specialized agency can save you time and resources, avoid delays, reduce administrative burdens, and increase the chances of finding the right fit for your organization.",
      "job_is_remote": true,
      "job_posted_human_readable": "1 day ago",
      "job_posted_at_timestamp": 1732492800,
      "job_posted_at_datetime_utc": "2024-11-25T00:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": null,
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DvkjeB63QCA2uyqZ3AAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Experience: 3+ years",
          "5+ years of experience as a Front-end Developer",
          "Hands-on experience with markup languages",
          "Familiarity with browser testing and debugging",
          "In-depth understanding of the entire web development process (design, development, and deployment)",
          "The ability to perform well in a fast-paced environment",
          "Strong communication skills to collaborate with cross-functional teams and explain technical concepts to non-technical stakeholders",
          "Positive and professional approach at all times",
          "Ability to work independently as well as part of a team",
          "Strong attention to detail",
          "Experience with Selenium, jQuery, FHIR API, SFTP, Stripes framework, and YouTrack a strong plus"
        ],
        "Benefits": [
          "Base Salary: $85K-$95K"
        ],
        "Responsibilities": [
          "They can help ensure that the process is efficient, well organized, and compliant with relevant regulations",
          "The Front-End Developer is responsible for building the client side of our web applications",
          "The Front-End Developer will translate our company and customer needs into functional and appealing interactive applications",
          "Create user-friendly web pages",
          "Maintain and improve website",
          "Optimize applications for maximum speed",
          "Design mobile-based features",
          "Collaborate with back-end developers and web designers to improve usability",
          "Get feedback from, and build solutions for users and customers",
          "Adhere to the Code of Conduct and all Company Policies and Procedures"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113400",
      "job_onet_job_zone": "3",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "A9BWoy_aC7zO2GuzAAAAAA==",
      "employer_name": "Cloud Resources LLC",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQxvjajCpWJRroUCiNgFljtLqcWC8Thx-bQ6EFr&s=0",
      "employer_website": "http://cloudresources.net",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "LinkedIn",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": ".Net  Developer",
      "job_apply_link": "https://www.linkedin.com/jobs/view/net-developer-at-cloud-resources-llc-4082193199?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/net-developer-at-cloud-resources-llc-4082193199?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "Job Title : .Net Developer\n\nLocation: Chicago IL\n\nType: 5 days in person\n\nDuration: 1-3 years\n\nDomain: Healthcare\n\nCore skills: Should be a hardcore developer on the following technologies\n\n.NET Core\n\nASP.NET\n\nC#\n\nBlazor UI Frameworks\n\nShould have deep experience integrating the application with AWS cloud services\n\nShould be able to work independently and own deliverables\n•",
      "job_is_remote": false,
      "job_posted_human_readable": "17 hours ago",
      "job_posted_at_timestamp": 1732546800,
      "job_posted_at_datetime_utc": "2024-11-25T15:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": null,
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DA9BWoy_aC7zO2GuzAAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Core skills: Should be a hardcore developer on the following technologies",
          ".NET Core",
          "Blazor UI Frameworks",
          "Should have deep experience integrating the application with AWS cloud services",
          "Should be able to work independently and own deliverables"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "vHdS_orruhTtv7iXAAAAAA==",
      "employer_name": "Jobs via Dice",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSQ655rHqQwI0u8U3lEthx_ixaJmT38PRydPBo4&s=0",
      "employer_website": null,
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "LinkedIn",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Backend Senior Software Developer",
      "job_apply_link": "https://www.linkedin.com/jobs/view/backend-senior-software-developer-at-jobs-via-dice-4082604124?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/backend-senior-software-developer-at-jobs-via-dice-4082604124?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Indeed",
          "apply_link": "https://www.indeed.com/viewjob?jk=63a03c4fa54ce331&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Dice",
          "apply_link": "https://www.dice.com/job-detail/5e23f7ba-87a6-481e-827f-9377338b1205?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "LazyApply",
          "apply_link": "https://lazyapply.com/jobpreview/5e23f7ba-87a6-481e-827f-9377338b1205?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "SimplyHired",
          "apply_link": "https://www.simplyhired.com/job/DybHZnC1JO0wKDnhJPhefn3coLG9y5_qwhKolted0No21tiYLp0WVQ?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "Dice is the leading career destination for tech experts at every stage of their careers. Our client, Deloitte, is seeking the following. Apply via Dice today!\n\nIf you are a technology visionary with a passion for transforming global tax business with digital technology, consider working with the US Tax Transformation technology team. This is an exciting opportunity to support global execution of Deloitte's tax strategy as we shift from \"doing digital\" to \"being digital\" by reimagining how we engage with our clients, deliver our services, operate our business, and create value.\n\nWhat You'll Do\n\nAs a Deloitte Tax Senior Software Back End Engineer, you will be responsible for design, development, debugging, testing, deploying, and supporting custom applications and modules that meet business requirements.\n\nResponsibilities:\n• Participate in requirements analysis.\n• Collaborate with US colleagues and Vendors' teams to produce software design and architecture.\n• Write clean, scalable code using .NET programming languages.\n• Test and deploy applications and systems.\n• Revise, update, refactor and debug code.\n• Develop, support, and maintain applications and technology solutions.\n• Ensure that all development efforts meet or exceed client expectations. Applications should meet requirements of scope, functionality, and time and adhere to all defined and agreed upon standards.\n• Become familiar with all development tools, testing tools, methodologies, and processes.\n• Become familiar with the project management methodology and processes.\n• Encourage collaborative efforts and camaraderie with on-shore and off-shore team members.\n• Demonstrate a strong working understanding of the industry best standards in software development and version controlling.\n• Ensure the quality and low bug rates of code released into production.\n• Work on agile projects, participate in daily SCRUM calls and provide task updates.\n\nThe Team\n\nDeloitte Tax LLP's Tax Transformation Office (TTO) is responsible for the design, development, and deployment of innovative, enterprise technology, tools, and standard processes to support the delivery of tax services. The TTO team focuses on enhancing Deloitte Tax LLP's ability to deliver comprehensive, value-added, and efficient tax services to our clients. It is a dynamic team with professionals of varying backgrounds from tax technical, technology development, change management, Six Sigma, and project management. The team consults and executes on a wide range of initiatives involving process and tool development and implementation including training development, engagement management, tool design, and implementation.\n\nQualifications\n\nRequired:\n• Ability to perform job responsibilities within a hybrid work model that requires US Tax professionals to co-locate in person 2 - 3 days per week\n• Bachelor's degree in computer science or a relevant discipline\n• 3+ years' experience leading technical delivery teams\n• Excellent analytical and problem-solving skills\n• Strong verbal and written communication skills; strong listening, interpersonal, and facilitation skills\n• Ability to travel up to 25%, on average, based on the work you do and the clients and industries/sectors you serve.\n• One of the following active accreditations obtained:\n• Licensed CPA in state of practice/primary office if eligible to sit for the CPA\n• If not CPA eligible:\n• Licensed Attorney\n• Enrolled Agent\n• Technology Certifications:\n• Alteryx Designer- Advanced Certification\n• ASQ - American Society for Quality - Software Quality Engineer\n• AWS Certified Solutions Architect\n• CBAP - Certified Business Analysis Professional\n• Certified in Risk and Information Systems Controls (CRISC)\n• Certified Information Systems Security Professional (CISSP)\n• Certified SAFe Advanced Scrum Master\n• Certified SAFe Agile Software Engineer\n• Certified SAFe Agilist\n• Certified SAFe Architect\n• Certified SAFe DevOps Practitioner\n• Certified SAFe Lean Portfolio Manager\n• Certified SAFe Practitioner\n• Certified SAFe Product Owner / Product Manager\n• Certified SAFe Scrum Master\n• Certified Scrum Developer (CSD)\n• Certified Scrum Product Owner (CSPO)\n• Certified Secure Software Lifecycle Professional (CSSLP)\n• Certified Secure Software Lifecycle Professional (CSSLP) - (ISC)2\n• IASA's Certified IT Architect (CITA) (Level F or A)\n• ISTQB (International Software Testing Qualifications Board)\n• ITIL Certification\n• Java: Java EE Enterprise Architect 5+, Java SE 5+ Programmer, Java EE 5+ Web Component Develope\n• Lifecycle Management and Advanced Functional Testing Certifications (HP)\n• MCSD: Application Lifecycle Management Solutions Developer\n• MCSD: SharePoint\n• MCSD: Web Applications\n• Microsoft Azure\n• Microsoft Certified Solutions Developer (MCSD)\n• Microsoft Certified Solutions Expert (MCSE)\n• Microsoft MCSD Certification\n• Open Group Certified Architect (Open CA)\n• Open Group Certified IT Specialist (Open CITS)\n• Oracle Certified Professional\n• Professional Scrum Developer (PSD)\n• Professional Scrum Product Owner (PSCPO) - SCRUM.org\n• Program Management Professional (PgMP)\n• Project Management Professional (PMP)\n• QAI Global Institute Certification\n• SEI - Software Engineering Institute Certification\n• Six Sigma (Green or Black Belt)\n• UI or UX Master Certification\n\nKey skills required:\n• 4+ years of strong hands-on experience on C#, SQL Server, OOPS Concepts, Micro Services Architecture.\n• At least one-year hands-on experience on .NET Core, ASP.NET Core Web API, SQL, NoSQL, Entity Framework 6 or above, Azure, Database performance tuning, Applying Design Patterns, Agile.\n• Skill for writing reusable libraries.\n• Excellent troubleshooting and communication skills.\n\nPreferred:\n• Knowledge on Angular, Mongo DB, NPM and Azure Devops Build/Release configuration.\n• Self-starter with solid analytical and problem-solving skills.\n\nThe wage range for this role takes into account the wide range of factors that are considered in making compensation decisions including but not limited to skill sets; experience and training; licensure and certifications; and other business and organizational needs. The disclosed range estimate has not been adjusted for the applicable geographic differential associated with the location at which the position may be filled. At Deloitte, it is not typical for an individual to be hired at or near the top of the range for their role and compensation decisions are dependent on the facts and circumstances of each case. A reasonable estimate of the current range is $91,350 to $193,440\n\nYou may also be eligible to participate in a discretionary annual incentive program, subject to the rules governing the program, whereby an award, if any, depends on various factors, including, without limitation, individual and organizational performance.\n\nInformation for applicants with a need for accommodation: Backend Senior Software Developer",
      "job_is_remote": false,
      "job_posted_human_readable": "15 hours ago",
      "job_posted_at_timestamp": 1732554000,
      "job_posted_at_datetime_utc": "2024-11-25T17:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": null,
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DvHdS_orruhTtv7iXAAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Become familiar with all development tools, testing tools, methodologies, and processes",
          "Ability to perform job responsibilities within a hybrid work model that requires US Tax professionals to co-locate in person 2 - 3 days per week",
          "Bachelor's degree in computer science or a relevant discipline",
          "3+ years' experience leading technical delivery teams",
          "Excellent analytical and problem-solving skills",
          "Strong verbal and written communication skills; strong listening, interpersonal, and facilitation skills",
          "Ability to travel up to 25%, on average, based on the work you do and the clients and industries/sectors you serve",
          "One of the following active accreditations obtained:",
          "Licensed CPA in state of practice/primary office if eligible to sit for the CPA",
          "If not CPA eligible:",
          "Licensed Attorney",
          "Enrolled Agent",
          "Technology Certifications:",
          "Alteryx Designer- Advanced Certification",
          "ASQ - American Society for Quality - Software Quality Engineer",
          "AWS Certified Solutions Architect",
          "CBAP - Certified Business Analysis Professional",
          "Certified in Risk and Information Systems Controls (CRISC)",
          "Certified Information Systems Security Professional (CISSP)",
          "Certified SAFe Advanced Scrum Master",
          "Certified SAFe Agile Software Engineer",
          "Certified SAFe Agilist",
          "Certified SAFe Architect",
          "Certified SAFe DevOps Practitioner",
          "Certified SAFe Lean Portfolio Manager",
          "Certified SAFe Practitioner",
          "Certified SAFe Product Owner / Product Manager",
          "Certified SAFe Scrum Master",
          "Certified Scrum Developer (CSD)",
          "Certified Scrum Product Owner (CSPO)",
          "Certified Secure Software Lifecycle Professional (CSSLP)",
          "Certified Secure Software Lifecycle Professional (CSSLP) - (ISC)2",
          "IASA's Certified IT Architect (CITA) (Level F or A)",
          "ISTQB (International Software Testing Qualifications Board)",
          "ITIL Certification",
          "Java: Java EE Enterprise Architect 5+, Java SE 5+ Programmer, Java EE 5+ Web Component Develope",
          "Lifecycle Management and Advanced Functional Testing Certifications (HP)",
          "MCSD: Application Lifecycle Management Solutions Developer",
          "MCSD:",
          "SharePoint",
          "MCSD: Web Applications",
          "Microsoft Azure",
          "Microsoft Certified Solutions Developer (MCSD)",
          "Microsoft Certified Solutions Expert (MCSE)",
          "Microsoft MCSD Certification",
          "Open Group Certified Architect (Open CA)",
          "Open Group Certified IT Specialist (Open CITS)",
          "Oracle Certified Professional",
          "Project Management Professional (PMP)",
          "SEI - Software Engineering Institute Certification",
          "Six Sigma (Green or Black Belt)",
          "UI or UX Master Certification",
          "4+ years of strong hands-on experience on C#, SQL Server, OOPS Concepts, Micro Services Architecture",
          "At least one-year hands-on experience on .NET Core, ASP",
          "NET Core Web API, SQL, NoSQL, Entity Framework 6 or above, Azure, Database performance tuning, Applying Design Patterns, Agile",
          "Skill for writing reusable libraries",
          "Excellent troubleshooting and communication skills",
          "The wage range for this role takes into account the wide range of factors that are considered in making compensation decisions including but not limited to skill sets; experience and training; licensure and certifications; and other business and organizational needs"
        ],
        "Benefits": [
          "Professional Scrum Developer (PSD)",
          "Professional Scrum Product Owner (PSCPO) - SCRUM.org",
          "Program Management Professional (PgMP)",
          "QAI Global Institute Certification",
          "A reasonable estimate of the current range is $91,350 to $193,440",
          "You may also be eligible to participate in a discretionary annual incentive program, subject to the rules governing the program, whereby an award, if any, depends on various factors, including, without limitation, individual and organizational performance"
        ],
        "Responsibilities": [
          "As a Deloitte Tax Senior Software Back End Engineer, you will be responsible for design, development, debugging, testing, deploying, and supporting custom applications and modules that meet business requirements",
          "Participate in requirements analysis",
          "Collaborate with US colleagues and Vendors' teams to produce software design and architecture",
          "Write clean, scalable code using .NET programming languages",
          "Test and deploy applications and systems",
          "Revise, update, refactor and debug code",
          "Develop, support, and maintain applications and technology solutions",
          "Ensure that all development efforts meet or exceed client expectations",
          "Applications should meet requirements of scope, functionality, and time and adhere to all defined and agreed upon standards",
          "Become familiar with the project management methodology and processes",
          "Encourage collaborative efforts and camaraderie with on-shore and off-shore team members",
          "Demonstrate a strong working understanding of the industry best standards in software development and version controlling",
          "Ensure the quality and low bug rates of code released into production",
          "Work on agile projects, participate in daily SCRUM calls and provide task updates",
          "Deloitte Tax LLP's Tax Transformation Office (TTO) is responsible for the design, development, and deployment of innovative, enterprise technology, tools, and standard processes to support the delivery of tax services",
          "The team consults and executes on a wide range of initiatives involving process and tool development and implementation including training development, engagement management, tool design, and implementation"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "BrjrkgA3XaT96Q96AAAAAA==",
      "employer_name": "Rocket Travel by Agoda",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSLl17UibzGtqTdIreoxNwQBHAi2To3MeiPpeNC&s=0",
      "employer_website": "https://www.rockettravel.com",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "LinkedIn",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Senior Software Engineer (Backend), Rocket Travel by Agoda",
      "job_apply_link": "https://www.linkedin.com/jobs/view/senior-software-engineer-backend-rocket-travel-by-agoda-at-rocket-travel-by-agoda-4082602001?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/senior-software-engineer-backend-rocket-travel-by-agoda-at-rocket-travel-by-agoda-4082602001?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "ZipRecruiter",
          "apply_link": "https://www.ziprecruiter.com/c/Rocket-Travel,-Inc./Job/Senior-Software-Engineer-(Backend),-Rocket-Travel-by-Agoda/-in-New-York,NY?jid=e03bc046ba92e127&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Built In",
          "apply_link": "https://builtin.com/job/senior-software-engineer-backend-rocket-travel-agoda/3618746?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Talentify",
          "apply_link": "https://www.talentify.io/job/senior-software-engineer-backend-rocket-travel-by-agoda-new-york-new-york-us-rocketmiles-6428558?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Jora",
          "apply_link": "https://us.jora.com/job/Lead-Software-Engineer-b8ac37d73e7613205e52d93c0ae88b02?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "Senior Software Engineer – Backend\n\nDuties: Involved in all facets of the software development process from inception to deployment. Add visibility to critical applications and processes. Evolve the Rocket toolkit by identifying and recommending the best tool for each task. Create A/B tests to bring our users a constantly improving experience. Improve existing code to make it more testable, tested, and resilient. Deploy daily to highly available applications. Maintain a sense of empathy for our customers and moving quickly where users are most acutely affected.\n\nRequirements: Requires Bachelor’s degree in Computer Science, or related field of study, and 5 years of experience in any job title/occupation/position working with JVM, Server-Side development, Infrastructure, Databases, and Frontend development. Experience specified must include 5 years of experience with each of the following: Java; and Infrastructure As Code Tooling. Experience specified must include 4 years of experience with each of the following: deploying applications to AWS or a similar cloud provider; Relational Database Management Systems; Non-relational Database Management Systems; Key-Value Stores; automated testing and tools; and a Frontend Framework like Angular or React. Experience specified must also include 2 years of experience with each of the following: Key Management Systems and using at least one of the following languages: Grails, Groovy, Kotlin or Clojure. Telecommuting permitted.\n\nInternal Referrals for this position are eligible for the Employee Referral Program.\n\nEmployer: Rocket Travel, Inc\n\nWork Location: 641 W Lake Street, Chicago, IL 60661\n\nHours: M-F, 40 hours/week\n\nSalary: $148,949/year\n\nApply at: To apply visit : https://job-boards.greenhouse.io/rocketmiles/jobs/6428558\n\nThis notice is being filed in connection with the filing of an application for permanent alien labor certification. Any person may provide documentary evidence bearing on the application to the regional certifying officer of the U.S. Department of Labor at: Certifying Officer, U.S. Department of Labor, Employment and Training Administration, Office of Foreign Labor Certification, 200 Constitution Avenue NW, Room N-5311, Washington, DC 20210, Tel: (202) 693-8200.",
      "job_is_remote": false,
      "job_posted_human_readable": "16 hours ago",
      "job_posted_at_timestamp": 1732550400,
      "job_posted_at_datetime_utc": "2024-11-25T16:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": null,
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DBrjrkgA3XaT96Q96AAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Requirements: Requires Bachelor’s degree in Computer Science, or related field of study, and 5 years of experience in any job title/occupation/position working with JVM, Server-Side development, Infrastructure, Databases, and Frontend development",
          "Experience specified must include 5 years of experience with each of the following: Java; and Infrastructure As Code Tooling",
          "Experience specified must include 4 years of experience with each of the following: deploying applications to AWS or a similar cloud provider; Relational Database Management Systems; Non-relational Database Management Systems; Key-Value Stores; automated testing and tools; and a Frontend Framework like Angular or React",
          "Experience specified must also include 2 years of experience with each of the following: Key Management Systems and using at least one of the following languages: Grails, Groovy, Kotlin or Clojure"
        ],
        "Benefits": [
          "Internal Referrals for this position are eligible for the Employee Referral Program",
          "Hours: M-F, 40 hours/week",
          "Salary: $148,949/year"
        ],
        "Responsibilities": [
          "Duties: Involved in all facets of the software development process from inception to deployment",
          "Add visibility to critical applications and processes",
          "Evolve the Rocket toolkit by identifying and recommending the best tool for each task",
          "Create A/B tests to bring our users a constantly improving experience",
          "Improve existing code to make it more testable, tested, and resilient",
          "Deploy daily to highly available applications",
          "Maintain a sense of empathy for our customers and moving quickly where users are most acutely affected"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "4Infa_kqZEwkbUK1AAAAAA==",
      "employer_name": "Morningstar",
      "employer_logo": null,
      "employer_website": "https://www.morningstar.com",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "Morningstar Jobs",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Senior Front-End Software Engineer (Vue/React)",
      "job_apply_link": "https://careers.morningstar.com/us/en/job/REQ-044461/Senior-Front-End-Software-Engineer-Vue-React?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "Morningstar Jobs",
          "apply_link": "https://careers.morningstar.com/us/en/job/REQ-044461/Senior-Front-End-Software-Engineer-Vue-React?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Workday",
          "apply_link": "https://morningstar.wd5.myworkdayjobs.com/en-US/Technology-and-Development/job/Senior-Software-Engineer_REQ-044461-2?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Built In Chicago",
          "apply_link": "https://www.builtinchicago.org/job/senior-software-engineer/250338?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "ZipRecruiter",
          "apply_link": "https://www.ziprecruiter.com/c/001_MstarInc-Morningstar-Inc.-Legal-Entity/Job/Senior-Front-End-Software-Engineer-(Vue-React)/-in-Chicago,IL?jid=596cace885a64c06&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Built In",
          "apply_link": "https://builtin.com/job/senior-software-engineer/2669194?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/senior-front-end-software-engineer-vue-react-at-morningstar-4051261991?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Diversity Jobs",
          "apply_link": "https://diversityjobs.com/career/9828905/Senior-Front-End-Software-Engineer-Illinois-Chicago?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "SimplyHired",
          "apply_link": "https://www.simplyhired.com/job/ocm4N6B3Q8AOEw_T8gZtVcDRDmagFbGIotUwb1V67Wejx21ROOLx1g?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "The Team:\nMorningstar believes in empowering investors through research, data, design, and technology. Morningstar, being a leading global provider of independent investment research, is looking for an innovative and passionate individual to serve as a Senior Software engineer in Morningstar's Research Products business. Research Products delivers Morningstar's research content through a suite of product lines as well as through shared service platforms, providing research content and comprehensive research workflows. We surface Morningstar's content and insights to retail investors, financial advisors, investment selection and due diligence teams, and other financial professionals.\n\nWe aim to provide a first-class experience in accessing, analyzing, and reporting on Morningstar research and data. We are deeply inquisitive; we do not take “that’s just the way it’s always been done” or “that’s just best practice” as valid answers and instead seek to fine-tune our product development process for maximum impact. We are empowered professionals who are given problems to solve and not tickets to implement. We value team productivity over individual productivity and this culture of “giving” means we enjoy and highly value collaborating with our teammates.\n\nThe Role:\nWe are looking for a Senior Software Engineer who is ready to jump into an expansive set of code bases across multiple stacks to join our team, grow with us, introduce us to new ideas and develop products that empower our users. As a member of the Research products development team, you will work closely with business product owners, as well as with remote development teams around the world. You will be exposed to all aspects of product development: design of user experience, system architecture, API/library development, leverage AWS services, code reviews, automated testing, infrastructure as code, systems monitoring & reliability, and support.\n\nThis is a hybrid role based in our Chicago office.\n\nJob Responsibilities:\n\nWe are looking for experienced UI developers who have dealt with complexity and large code bases, and who have developed strategies for tackling them. Developers who understand how to ship code and can make the correct trade-offs between perfection and delivery. We value innovation and are looking for team members who introduce new ideas, technologies and practices. We work with a variety of technologies including Vue/Node.JS, Java, Amazon Web Services, Cloud computing, OpenSearch and more.\n\nQualifications:\n• Friendly and enjoys working in a collaborative team with excellent spoken and written communication skills. Humble, honest, and to the point\n• Bachelor of Science in Computer Science, Engineering, or equivalent experience\n• 5+ Years of experience in Software Development\n• Solid understanding of computer science fundamentals: data structures, algorithms, design patterns and UI frameworks\n• Experience in web-based software applications and services.\n• Experience in HTML, CSS, Javascript and Angular / React or Vue JS\n• Experience with professional software build, test and deploy practices\n• Experience in Cloud services and good understanding cloud computing, preferred AWS (or Azure, GCP)\n• Experience with agile principles including test driven development and CICD\n• Creative thinker with ability to solve complex problems\n• Strong proficiency in building and consuming RESTful API’s\n• Knowledge of scalable architectures\n• Knowledge of Web UI componentization\n• Knowledge of any backend development in C++, Java, C#, Node.js, or Python and the ability plus willingness to adopt any languages\n• Excellent self-study skills\n\nNice to have:\n• Experience with Microservices or serverless applications\n• Experience with automated infrastructure configurations and orchestration.\n• Experience with CloudFormation, Docker, Serverless\n• Experience with SQL and non-SQL databases\n• Experience with Amazon Web Services technologies like Serverless/Lambdas, API gateway, ECS, KMS/IAM, CloudFront, EC2\n\n001_MstarInc Morningstar Inc. Legal Entity\n\nMorningstar’s hybrid work environment gives you the opportunity to work remotely and collaborate in-person each week. We’ve found that we’re at our best when we’re purposely together on a regular basis, at least three days each week. A range of other benefits are also available to enhance flexibility as needs change. No matter where you are, you’ll have tools and resources to engage meaningfully with your global colleagues.",
      "job_is_remote": false,
      "job_posted_human_readable": "7 days ago",
      "job_posted_at_timestamp": 1731974400,
      "job_posted_at_datetime_utc": "2024-11-19T00:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": null,
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3D4Infa_kqZEwkbUK1AAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Developers who understand how to ship code and can make the correct trade-offs between perfection and delivery",
          "Friendly and enjoys working in a collaborative team with excellent spoken and written communication skills",
          "Humble, honest, and to the point",
          "Bachelor of Science in Computer Science, Engineering, or equivalent experience",
          "5+ Years of experience in Software Development",
          "Solid understanding of computer science fundamentals: data structures, algorithms, design patterns and UI frameworks",
          "Experience in web-based software applications and services",
          "Experience in HTML, CSS, Javascript and Angular / React or Vue JS",
          "Experience with professional software build, test and deploy practices",
          "Experience with agile principles including test driven development and CICD",
          "Creative thinker with ability to solve complex problems",
          "Strong proficiency in building and consuming RESTful API’s",
          "Knowledge of scalable architectures",
          "Knowledge of Web UI componentization",
          "Knowledge of any backend development in C++, Java, C#, Node.js, or Python and the ability plus willingness to adopt any languages",
          "Excellent self-study skills",
          "Experience with Microservices or serverless applications",
          "Experience with automated infrastructure configurations and orchestration",
          "Experience with CloudFormation, Docker, Serverless",
          "Experience with SQL and non-SQL databases",
          "Experience with Amazon Web Services technologies like Serverless/Lambdas, API gateway, ECS, KMS/IAM, CloudFront, EC2"
        ],
        "Responsibilities": [
          "We surface Morningstar's content and insights to retail investors, financial advisors, investment selection and due diligence teams, and other financial professionals",
          "We are looking for a Senior Software Engineer who is ready to jump into an expansive set of code bases across multiple stacks to join our team, grow with us, introduce us to new ideas and develop products that empower our users",
          "As a member of the Research products development team, you will work closely with business product owners, as well as with remote development teams around the world",
          "You will be exposed to all aspects of product development: design of user experience, system architecture, API/library development, leverage AWS services, code reviews, automated testing, infrastructure as code, systems monitoring & reliability, and support",
          "We are looking for experienced UI developers who have dealt with complexity and large code bases, and who have developed strategies for tackling them"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113400",
      "job_onet_job_zone": "3",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "KfLVljib9kK_YhNrAAAAAA==",
      "employer_name": "hackajob",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQYoo7Keio8qsOsEA4YelR08GaHWug8MGWcCB-&s=0",
      "employer_website": "https://hackajob.com",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "LinkedIn",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Senior Software Engineer C++",
      "job_apply_link": "https://www.linkedin.com/jobs/view/senior-software-engineer-c%2B%2B-at-hackajob-4085382885?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/senior-software-engineer-c%2B%2B-at-hackajob-4085382885?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Gina's Tech Jobs!",
          "apply_link": "https://www.ginastechjobs.com/job/senior-c-software-engineer-2/?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": true
        },
        {
          "publisher": "Taro",
          "apply_link": "https://www.jointaro.com/jobs/belvedere-trading/senior-c-software-engineer/?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Learn4Good",
          "apply_link": "https://www.learn4good.com/jobs/chicago/illinois/info_technology/3742765256/e/?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "Job Title: Senior Software Development Engineer, HPC & AI Networking\n\nLocation: Hybrid in Chicago, IL\n\nSalary: $ 113000-259500\n\nAbout the Role:\n\nJoin a leading-edge R&D team at Argonne National Laboratory, located in the dynamic Chicago Metropolitan Area. In this key role with dual reporting lines to both a partner R&D manager and an ANL manager, you will work on groundbreaking high-performance computing (HPC) technologies. Your focus will be on advancing diagnostics and monitoring applications for HPC networks, supporting the development of one of the world’s most powerful supercomputing systems. This is an exciting opportunity to contribute directly to next-gen computing in a hands-on, collaborative, on-site environment. If you’re passionate about pushing supercomputing capabilities forward, this role will place you at the forefront of HPC innovation.\n\nResponsibilities:\n• Project Coordination: Act as the primary point of contact, coordinating responsibilities and commitments between managers at the partner and ANL.\n• Customer Issue Resolution: Track and manage resolution for customer HPC interconnect issues, working with R&D to deploy resources for advanced troubleshooting.\n• Diagnostics & Documentation: Analyze and document fabric-related issues, conduct Root Cause Analyses (RCAs), and assist with upgrade planning and related documentation tasks.\n• Software Development: Develop software that structures and analyzes data within monitoring and analytics systems, enhancing diagnostic applications.\n• Performance Optimization: Document maintenance protocols, execute programming tasks, and monitor system performance metrics for continual optimization.\n• Technical Leadership: Lead technical initiatives across teams, mentoring peers and driving innovation in network diagnostics and monitoring for HPC.\n• Problem Solving & Innovation: Bring deep technical expertise to solve complex networking issues, driving improvements in efficiency, cost, and customer satisfaction.\n\nQualifications:\n• Experience: 5+ years in software development, with a focus on distributed systems or network programming preferred.\n\nTechnical Proficiency:\n• Expertise in C/C++ and Python.\n• Advanced Linux and kernel-level programming skills.\n• Strong foundation in data structures, algorithms, and operating systems.\n• Experience with distributed systems, including CAP theorem, Consensus, messaging, and high-availability architecture.\n• Low-latency networking, particularly in HPC network fabric.\n• Problem-Solving: Exceptional troubleshooting abilities for complex networking issues.\n• Communication: Strong organizational, verbal, and written communication skills.\n• Education: Bachelor’s degree in Computer Science, Engineering, or related fields.\n• Mindset: A proactive approach, with an affinity for simplicity, scalability, and agile collaboration. Enthusiastic about continuous learning and mentorship.\n\nPreferred Skills:\n• Experience with cloud architectures, cross-domain knowledge, design thinking, DevOps, distributed computing, microservices, security, solutions design, testing, automation, and user experience (UX).\n\nBenefits:\n• Health & Wellbeing: Comprehensive benefits supporting physical, financial, and emotional wellbeing for team members and their families.\n• Personal & Professional Development: Dedicated programs for career growth and goal achievement, whether you’re focused on deepening expertise or exploring new opportunities.\n• Diversity, Inclusion & Belonging: We foster an inclusive environment where diverse backgrounds are valued and contribute to success. We support flexibility for balancing work and personal life while fostering a collaborative culture driven by bold ideas.\n\nLocation: #UnitedStates #Chicago\n\nWhy Sign Up?\n• Be part of a company that views challenges as opportunities to evolve and innovate.\n• Work in a supportive environment where your skills directly contribute to the team’s success.\n• Engage with solutions that impact businesses and communities globally.\n\nInterested in being a part of our journey? Sign Up now and let’s build stronger, more resilient futures together!\n\nhackajob is a recruitment platform that will match you with relevant roles based on your preferences and in order to be matched with the roles you need to create an account with us.\n\nIf you're interested in finding out more about this fantastic opportunity, please get your application in and we can arrange a call.",
      "job_is_remote": false,
      "job_posted_human_readable": "13 hours ago",
      "job_posted_at_timestamp": 1732561200,
      "job_posted_at_datetime_utc": "2024-11-25T19:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": [
        "health_insurance"
      ],
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DKfLVljib9kK_YhNrAAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_min_salary": 113000,
      "job_max_salary": 260000,
      "job_salary_currency": null,
      "job_salary_period": "YEAR",
      "job_highlights": {
        "Qualifications": [
          "Expertise in C/C++ and Python",
          "Advanced Linux and kernel-level programming skills",
          "Strong foundation in data structures, algorithms, and operating systems",
          "Experience with distributed systems, including CAP theorem, Consensus, messaging, and high-availability architecture",
          "Low-latency networking, particularly in HPC network fabric",
          "Problem-Solving: Exceptional troubleshooting abilities for complex networking issues",
          "Communication: Strong organizational, verbal, and written communication skills",
          "Education: Bachelor’s degree in Computer Science, Engineering, or related fields",
          "Mindset: A proactive approach, with an affinity for simplicity, scalability, and agile collaboration",
          "Enthusiastic about continuous learning and mentorship"
        ],
        "Benefits": [
          "Salary: $ 113000-259500",
          "Health & Wellbeing: Comprehensive benefits supporting physical, financial, and emotional wellbeing for team members and their families",
          "Personal & Professional Development: Dedicated programs for career growth and goal achievement, whether you’re focused on deepening expertise or exploring new opportunities",
          "Be part of a company that views challenges as opportunities to evolve and innovate",
          "Work in a supportive environment where your skills directly contribute to the team’s success"
        ],
        "Responsibilities": [
          "In this key role with dual reporting lines to both a partner R&D manager and an ANL manager, you will work on groundbreaking high-performance computing (HPC) technologies",
          "Your focus will be on advancing diagnostics and monitoring applications for HPC networks, supporting the development of one of the world’s most powerful supercomputing systems",
          "Project Coordination: Act as the primary point of contact, coordinating responsibilities and commitments between managers at the partner and ANL",
          "Customer Issue Resolution: Track and manage resolution for customer HPC interconnect issues, working with R&D to deploy resources for advanced troubleshooting",
          "Diagnostics & Documentation: Analyze and document fabric-related issues, conduct Root Cause Analyses (RCAs), and assist with upgrade planning and related documentation tasks",
          "Software Development: Develop software that structures and analyzes data within monitoring and analytics systems, enhancing diagnostic applications",
          "Performance Optimization: Document maintenance protocols, execute programming tasks, and monitor system performance metrics for continual optimization",
          "Technical Leadership: Lead technical initiatives across teams, mentoring peers and driving innovation in network diagnostics and monitoring for HPC",
          "Problem Solving & Innovation: Bring deep technical expertise to solve complex networking issues, driving improvements in efficiency, cost, and customer satisfaction"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "bOCWtdJ7_-47PC2CAAAAAA==",
      "employer_name": "SynergisticIT",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS-1OJeonynfXvsEjtnqvn3XB7x3ZNPsleGoH57&s=0",
      "employer_website": "https://www.synergisticit.com",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "ZipRecruiter",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Remote Software Developer",
      "job_apply_link": "https://www.ziprecruiter.com/c/SynergisticIT/Job/Remote-Software-Developer/-in-Chicago,IL?jid=d9dad7ebd20daf78&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "ZipRecruiter",
          "apply_link": "https://www.ziprecruiter.com/c/SynergisticIT/Job/Remote-Software-Developer/-in-Chicago,IL?jid=d9dad7ebd20daf78&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "Since 2010 Synergisticit has helped Jobseekers get employed in the tech Job market by providing candidates the requisite skills, experience and technical competence to outperform at interviews and at clients. Here at SynergisticIT We just don't focus on getting you a tech Job we make careers.\nIn this Job market also, our candidates are able to achieve multiple job offers and $100k + salaries.\n\nplease check the below links :\n\nSynergisticit Pics /Salaries of Successful Candidates\n\nSynergisticit at Oracle Cloudworld 2023\n\nSynergisticit at Gartner Data & Analytics summit\n\nWhy do Tech Companies not Hire recent Computer Science Graduates | SynergisticIT\n\nTechnical Skills or Experience? | Which one is important to get a Job? | SynergisticIT\n\nAll Positions are open for all visas and US citizens\nWe at Synergisticit understand the problem of the mismatch between employer's requirements and Employee skills and that's why since 2010 we have helped 1000's of candidates get jobs at technology clients like apple, google, Paypal, western union, Client, visa, walmart labs etc to name a few.\nCurrently, We are looking for entry-level software programmers, Java Full stack developers, Python/Java developers, Data analysts/ Data Scientists, Machine Learning engineers for full time positions with clients.\nWho Should Apply Recent Computer science/Engineering /Mathematics/Statistics or Science Graduates or People looking to switch careers or who have had gaps in employment and looking to make their careers in the Tech Industry.\nWe assist in filing for STEM extension and also for H1b and Green card filing to Candidates\nWe want Data Science/Machine learning/Data Analyst and Java Full stack candidates\nFor data Science/Machine learning Positions\nREQUIRED SKILLS\nBachelors degree or Masters degree in Computer Science, Computer Engineering, Electrical Engineering, Information Systems, IT\nProject work on the technologies needed\nHighly motivated, self-learner, and technically inquisitive\nExperience in programming language Java and understanding of the software development life cycle\nKnowledge of Statistics, Gen AI, LLM, Python, Computer Vision, data visualization tools\nExcellent written and verbal communication skills\nPreferred skills: NLP, Text mining, Tableau, PowerBI, Databricks, Tensorflow\nREQUIRED SKILLS For Java /Full stack/Software Positions\nBachelors degree or Masters degree in Computer Science, Computer Engineering, Electrical Engineering, Information Systems, IT\nHighly motivated, self-learner, and technically inquisitive\nExperience in programming language Java and understanding of the software development life cycle\nProject work on the skills\nKnowledge of Core Java , javascript , C++ or software programming\nSpring boot, Microservices, Docker, Jenkins, Github, Kubernates and REST API's experience\nExcellent written and verbal communication skills\nIf you get emails from our Job Placement team and are not interested please email them or ask them to take you off their distribution list and make you unavailable as they share the same database with the client servicing team who only connect with candidates who are matching client requirements.\nNo phone calls please. Shortlisted candidates would be reached out. No third party or agency candidates or c2c candidates",
      "job_is_remote": false,
      "job_posted_human_readable": "4 days ago",
      "job_posted_at_timestamp": 1732233600,
      "job_posted_at_datetime_utc": "2024-11-22T00:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": null,
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DbOCWtdJ7_-47PC2CAAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Who Should Apply Recent Computer science/Engineering /Mathematics/Statistics or Science Graduates or People looking to switch careers or who have had gaps in employment and looking to make their careers in the Tech Industry",
          "For data Science/Machine learning Positions",
          "Bachelors degree or Masters degree in Computer Science, Computer Engineering, Electrical Engineering, Information Systems, IT",
          "Project work on the technologies needed",
          "Highly motivated, self-learner, and technically inquisitive",
          "Experience in programming language Java and understanding of the software development life cycle",
          "Knowledge of Statistics, Gen AI, LLM, Python, Computer Vision, data visualization tools",
          "Excellent written and verbal communication skills",
          "REQUIRED SKILLS For Java /Full stack/Software Positions",
          "Bachelors degree or Masters degree in Computer Science, Computer Engineering, Electrical Engineering, Information Systems, IT",
          "Highly motivated, self-learner, and technically inquisitive",
          "Experience in programming language Java and understanding of the software development life cycle",
          "Project work on the skills",
          "Knowledge of Core Java , javascript , C++ or software programming",
          "Spring boot, Microservices, Docker, Jenkins, Github, Kubernates and REST API's experience",
          "Excellent written and verbal communication skills"
        ],
        "Benefits": [
          "In this Job market also, our candidates are able to achieve multiple job offers and $100k + salaries"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "l6QD8L-p9zXP11jHAAAAAA==",
      "employer_name": "Elevance Health",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQWMs1pINCEyfagjJDvcLoZ3IPqa3zKmJZ4jY5d&s=0",
      "employer_website": "https://www.elevancehealth.com",
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "LinkedIn",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "IBM BPM/BAW Developer",
      "job_apply_link": "https://www.linkedin.com/jobs/view/ibm-bpm-baw-developer-at-elevance-health-4083026414?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/ibm-bpm-baw-developer-at-elevance-health-4083026414?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Elevance Health Jobs",
          "apply_link": "https://elevancehealth.dejobs.org/chicago-il/ibm-bpmbaw-developer/53A9FE5500E34893868DB46728E5DC54/job/?utm_campaign=google_jobs_apply&utm_medium=organic&utm_source=levels.fyi&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Adzuna",
          "apply_link": "https://www.adzuna.com/details/4937967545?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Levels.fyi",
          "apply_link": "https://www.levels.fyi/jobs?jobId=140084866635965126&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Talentify",
          "apply_link": "https://www.talentify.io/job/ibm-bpmbaw-developer-chicago-illinois-us-elevance-health-jr135157?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "WhatJobs",
          "apply_link": "https://www.whatjobs.com/job/IBM-BPM-BAW/chicago-illinois/1786079200?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Jobrapido.com",
          "apply_link": "https://us.jobrapido.com/jobpreview/4519055848869199872?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Jobilize",
          "apply_link": "https://www.jobilize.com/job/us-il-chicago-ibm-bpm-baw-developer-elevance-health-hiring-now-job?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        }
      ],
      "job_description": "Location: This position will work a hybrid model (remote & office). The ideal candidate will live within 50 miles of one of our Elevance Health PulsePoint office locations.\n\nPreferred Location: Indianapolis, IN\n\nThe IBM BPM/BAW Developer is responsible for programming on specific application subsets of the company's application portfolio; designing, developing and implementing the business processes using IBM BAW product suites.\n\nHow You Will Make An Impact\n• Maintains active relationships with customers to determine business requirements and leads requirements gathering meetings.\n• Owns the change request process and may coordinate with other teams as necessary.\n• Develops and owns list of final enhancements.\n• Develops and defines application scope and objectives and prepares technical and/or functional specifications from with programs will be written. Performs technical design reviews and code reviews.\n• Ensures unit test is completed and meets the test plan requirements, system testing is completed and system is implemented according to plan.\n• Assesses current status and supports data information planning.\n• Coordinates on-call support and ensures effective monitoring of system.\n• Maintains technical development environment.\n• Mentors others and may lead multiple or small to medium sized projects.\n• Facilitates group sessions to elicit complex information on requirements clarification, design sessions, code reviews and troubleshooting issues.\n• Supports vendor evaluation.\n\nMinimum Requirements\n• Requires an BA/BS degree in Information Technology, Computer Science or related field of study and minimum of 5 years experience with multi dimensional platform, business and technical applications; or any combination of education and experience, which would provide an equivalent background.\n• This position is part of our NGS (National Government Services) division which, per CMS TDL 190275, requires foreign national applicants meet the residency requirement of living in the United States at least three of the past five years.\n\nPreferred Skills, Capabilities & Experiences\n• In-depth knowledge on designing, developing and implementing the business processes using IBM BAW product suites is preferred..\n• Experience working in Case Manager, IBM BPM, FileNet and Microservices preferred.\n• Experience in IBM BPM/ BAW process designing and UI/coach development preferred.\n• Experience in using Web Process Designer, Process and Service Flows is preferred.\n• Experience on Integrations with BAW such as REST/SOAP/Java is helpful.\n• Experience in various sort of automation techniques for BAW and BPM in general is preferred.\n• Technical knowledge of database technologies and products such as MS SQL server, Oracle, SQL, No-SQL is preferred.\n• Exposure of scripting technologies and various java script frameworks.\n• Understanding of basic platform administration concepts such as process admin, snapshot deployment and user management etc. is preferred.\n• Experience in an Agile Technology Development environment preferably SAFe is preferred.\n\nIf this job is assigned to any Government Business Division entity, the applicant and incumbent fall under a 'sensitive position' work designation and may be subject to additional requirements beyond those associates outside Government Business Divisions. Requirements include but are not limited to more stringent and frequent background checks and/or government clearances, segregation of duties principles, role specific training, monitoring of daily job functions, and sensitive data handling instructions. Associates in these jobs must follow the specific policies, procedures, guidelines, etc. as stated by the Government Business Division in which they are employed.\n\nPlease be advised that Elevance Health only accepts resumes for compensation from agencies that have a signed agreement with Elevance Health. Any unsolicited resumes, including those submitted to hiring managers, are deemed to be the property of Elevance Health.\n\nWho We Are\n\nElevance Health is a health company dedicated to improving lives and communities – and making healthcare simpler. We are a Fortune 25 company with a longstanding history in the healthcare industry, looking for leaders at all levels of the organization who are passionate about making an impact on our members and the communities we serve.\n\nHow We Work\n\nAt Elevance Health, we are creating a culture that is designed to advance our strategy but will also lead to personal and professional growth for our associates. Our values and behaviors are the root of our culture. They are how we achieve our strategy, power our business outcomes and drive our shared success - for our consumers, our associates, our communities and our business.\n\nWe offer a range of market-competitive total rewards that include merit increases, paid holidays, Paid Time Off, and incentive bonus programs (unless covered by a collective bargaining agreement), medical, dental, vision, short and long term disability benefits, 401(k) +match, stock purchase plan, life insurance, wellness programs and financial education resources, to name a few.\n\nElevance Health operates in a Hybrid Workforce Strategy. Unless specified as primarily virtual by the hiring manager, associates are required to work at an Elevance Health location at least once per week, and potentially several times per week. Specific requirements and expectations for time onsite will be discussed as part of the hiring process. Candidates must reside within 50 miles or 1-hour commute each way of a relevant Elevance Health location.\n\nThe health of our associates and communities is a top priority for Elevance Health. We require all new candidates in certain patient/member-facing roles to become vaccinated against COVID-19. If you are not vaccinated, your offer will be rescinded unless you provide an acceptable explanation. Elevance Health will also follow all relevant federal, state and local laws.\n\nElevance Health is an Equal Employment Opportunity employer and all qualified applicants will receive consideration for employment without regard to age, citizenship status, color, creed, disability, ethnicity, genetic information, gender (including gender identity and gender expression), marital status, national origin, race, religion, sex, sexual orientation, veteran status or any other status or condition protected by applicable federal, state, or local laws. Applicants who require accommodation to participate in the job application process may contact elevancehealthjobssupport@elevancehealth.com for assistance.",
      "job_is_remote": false,
      "job_posted_human_readable": "16 hours ago",
      "job_posted_at_timestamp": 1732550400,
      "job_posted_at_datetime_utc": "2024-11-25T16:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": [
        "paid_time_off",
        "dental_coverage",
        "health_insurance"
      ],
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3Dl6QD8L-p9zXP11jHAAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Requires an BA/BS degree in Information Technology, Computer Science or related field of study and minimum of 5 years experience with multi dimensional platform, business and technical applications; or any combination of education and experience, which would provide an equivalent background",
          "This position is part of our NGS (National Government Services) division which, per CMS TDL 190275, requires foreign national applicants meet the residency requirement of living in the United States at least three of the past five years",
          "If this job is assigned to any Government Business Division entity, the applicant and incumbent fall under a 'sensitive position' work designation and may be subject to additional requirements beyond those associates outside Government Business Divisions",
          "Candidates must reside within 50 miles or 1-hour commute each way of a relevant Elevance Health location"
        ],
        "Benefits": [
          "We offer a range of market-competitive total rewards that include merit increases, paid holidays, Paid Time Off, and incentive bonus programs (unless covered by a collective bargaining agreement), medical, dental, vision, short and long term disability benefits, 401(k) +match, stock purchase plan, life insurance, wellness programs and financial education resources, to name a few"
        ],
        "Responsibilities": [
          "Maintains active relationships with customers to determine business requirements and leads requirements gathering meetings",
          "Owns the change request process and may coordinate with other teams as necessary",
          "Develops and owns list of final enhancements",
          "Develops and defines application scope and objectives and prepares technical and/or functional specifications from with programs will be written",
          "Performs technical design reviews and code reviews",
          "Ensures unit test is completed and meets the test plan requirements, system testing is completed and system is implemented according to plan",
          "Assesses current status and supports data information planning",
          "Coordinates on-call support and ensures effective monitoring of system",
          "Maintains technical development environment",
          "Mentors others and may lead multiple or small to medium sized projects",
          "Facilitates group sessions to elicit complex information on requirements clarification, design sessions, code reviews and troubleshooting issues",
          "Supports vendor evaluation",
          "Requirements include but are not limited to more stringent and frequent background checks and/or government clearances, segregation of duties principles, role specific training, monitoring of daily job functions, and sensitive data handling instructions",
          "Unless specified as primarily virtual by the hiring manager, associates are required to work at an Elevance Health location at least once per week, and potentially several times per week"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    },
    {
      "job_id": "pXqxt7GahYMc3AjyAAAAAA==",
      "employer_name": "Northwestern Medicine Corporate",
      "employer_logo": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQEM1MQoUp8QrL0HclHpJGt9qDK06NbBIxUX7SX&s=0",
      "employer_website": null,
      "employer_company_type": null,
      "employer_linkedin": null,
      "job_publisher": "Northwestern Medicine",
      "job_employment_type": "FULLTIME",
      "job_employment_types": [
        "FULLTIME"
      ],
      "job_employment_type_text": "Full-time",
      "job_title": "Principal Software Developer",
      "job_apply_link": "https://jobs.nm.org/job/chicago/principal-software-developer/27763/69362862192?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
      "job_apply_is_direct": false,
      "job_apply_quality_score": null,
      "apply_options": [
        {
          "publisher": "Northwestern Medicine",
          "apply_link": "https://jobs.nm.org/job/chicago/principal-software-developer/27763/69362862192?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "ZipRecruiter",
          "apply_link": "https://www.ziprecruiter.com/c/Northwestern-Medicine/Job/Principal-Software-Developer/-in-Chicago,IL?jid=f2fc0c072488d554&utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "WayUp",
          "apply_link": "https://www.wayup.com/i-j-Principal-Software-Developer-Northwestern-Memorial-Healthcare-168962042846820/?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Dice",
          "apply_link": "https://www.dice.com/job-detail/756a68a0-5746-40c6-bda5-d984b8bc1154?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "LinkedIn",
          "apply_link": "https://www.linkedin.com/jobs/view/principal-software-developer-at-northwestern-memorial-hospital-4012731071?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "SimplyHired",
          "apply_link": "https://www.simplyhired.com/job/tI5DTRWniDLzSmPXk4eQBcNXfou5llAB9E597ClULh7uD1NzNjO0Hg?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Jooble",
          "apply_link": "https://jooble.org/jdp/315551213395990990?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": false
        },
        {
          "publisher": "Adzuna",
          "apply_link": "https://www.adzuna.com/details/4930929037?utm_campaign=google_jobs_apply&utm_source=google_jobs_apply&utm_medium=organic",
          "is_direct": true
        }
      ],
      "job_description": "Remote work from Illinois, Wisconsin, Indiana, and Iowa\n\nDescription\n\nThe Principal Software Developer, reflects the mission, vision, and values of NM, adheres to the organization’s Code of Ethics and Corporate Compliance Program, and complies with all relevant policies, procedures, guidelines and all other regulatory and accreditation standards.\n\nThe Principal Software Developer is responsible for designing, developing, testing, debugging and deploying applications for Northwestern Medicine. As a Principal Software Developer, you will play a crucial role in designing and implementing complex software solutions. They lead projects, mentor developers, and collaborate with cross-functional teams to deliver high-quality software solutions.\n\nNorthwestern Medicine Information Services drives innovative, high-value solutions to transform health care.\n\nWe are committed to supporting the relentless pursuit of better medicine by providing exceptional service to our patients and guests as well as internal clients across the organization. To ensure excellence, our team goes to extraordinary lengths to ensure that our systems work together seamlessly.\n\nNorthwestern Medicine understands that technology plays an integral role in shaping the future of health care. Information Services strategically supports the organization by:\n• Leveraging AI, automation and rollout of advanced cyber controls that support digital transformation strategies\n• Implementing advanced technologies in clinical and administrative areas\n• Furthering development of the end user support model to help enhance modern infrastructure\n\nResponsibilities:\n• Work with engineers and other cross functional teams like Product Management, Project Management, Release Engineering, Quality Assurance, Operations teams etc. to develop innovative solutions that meet system needs with respect to functionality, performance, scalability, reliability, realistic implementation schedules, and adherence to development goals and principles.\n• Lead the software development team, providing technical guidance, mentorship, and support to team members.\n• Lead and participate in agile development methodologies, ensuring timely delivery of high-quality software solutions.\n• Develop software solutions by studying information needs; conferring with users; studying systems flow, data usage and work processes; investigating problem areas\n• Participate in the Agile software development from concept, design to full-stack coding and testing\n• Document and demonstrate solutions by developing documentation, flowcharts, layouts, diagrams, charts, code comments and clear code\n• Stay current on development tools, programming techniques and computing equipment; participating in educational opportunities; reading professional publications;\n• Provide senior level support in project, ad hock status / issues meetings and conference calls\n• Provide technical expertise, guidance, coaching, training and educational opportunities to assist team members in closing performance and skill set gaps in order for them to advance.\n• Mentor software development team\n• Make informed decisions quickly and take ownership of services and applications at scale\n• Create internal process improvement initiatives within team's toolsets and workflows\n• Perform code reviews\n• Provide operational support as needed\n• Lead the design and development of complex software projects.\n• Collaborate with product managers, designers, and other stakeholders to understand requirements and deliver innovative software solutions.\n• Analyze complex technical problems and propose creative solutions. Troubleshoot issues and collaborate with team members to resolve challenges.\n• Contribute to the development of the technology roadmap, aligning technical strategies with business objectives.\n• Assess technical risks and develop mitigation strategies.\n• Advocate for user-centric design and ensure that software solutions meet or exceed customer expectations.\n• Other duties as assigned\n\nQualifications\n\nRequired:\n• Bachelor’s degree in Computer Science or related field or equivalent years of experience\n• 8+ years of experience as a full stack software developer\n\nPreferred:\n• Delivering cloud services in an engineering role\n• Distributed systems design and analysis experience\n• Web development using the .Net Framework, .Net Core, C#, ASP.Net, Web Services (Web API), WCF, REST, JavaScript, JQuery, HTML, CSS\n• Microsoft SQL Server database design with experience in query optimization\n• Front end frameworks (Angular, Razor, React, Blazor etc.)\n• Source Control: TFS, Git\n• Experience working in an agile environment\n• Experience creating CI/CD pipelines, and utilizing tools such as Azure DevOps\n• IAC (Terraform, Biceps)\n• Microsoft Azure\n\nEqual Opportunity\n\nNorthwestern Medicine is an affirmative action/equal opportunity employer and does not discriminate in hiring or employment on the basis of age, sex, race, color, religion, national origin, gender identity, veteran status, disability, sexual orientation or any other protected status.",
      "job_is_remote": false,
      "job_posted_human_readable": "19 days ago",
      "job_posted_at_timestamp": 1730937600,
      "job_posted_at_datetime_utc": "2024-11-07T00:00:00.000Z",
      "job_location": "Chicago, IL",
      "job_city": "Chicago",
      "job_state": "Illinois",
      "job_country": "US",
      "job_latitude": 41.8781136,
      "job_longitude": -87.6297982,
      "job_benefits": null,
      "job_google_link": "https://www.google.com/search?q=jobs&gl=us&hl=en&udm=8#vhid=vt%3D20/docid%3DpXqxt7GahYMc3AjyAAAAAA%3D%3D&vssid=jobs-detail-viewer",
      "job_offer_expiration_datetime_utc": null,
      "job_offer_expiration_timestamp": null,
      "job_required_experience": {
        "no_experience_required": false,
        "required_experience_in_months": null,
        "experience_mentioned": false,
        "experience_preferred": false
      },
      "job_salary": null,
      "job_min_salary": null,
      "job_max_salary": null,
      "job_salary_currency": null,
      "job_salary_period": null,
      "job_highlights": {
        "Qualifications": [
          "Bachelor’s degree in Computer Science or related field or equivalent years of experience",
          "8+ years of experience as a full stack software developer"
        ],
        "Responsibilities": [
          "The Principal Software Developer is responsible for designing, developing, testing, debugging and deploying applications for Northwestern Medicine",
          "As a Principal Software Developer, you will play a crucial role in designing and implementing complex software solutions",
          "Leveraging AI, automation and rollout of advanced cyber controls that support digital transformation strategies",
          "Implementing advanced technologies in clinical and administrative areas",
          "Furthering development of the end user support model to help enhance modern infrastructure",
          "Work with engineers and other cross functional teams like Product Management, Project Management, Release Engineering, Quality Assurance, Operations teams etc",
          "to develop innovative solutions that meet system needs with respect to functionality, performance, scalability, reliability, realistic implementation schedules, and adherence to development goals and principles",
          "Lead the software development team, providing technical guidance, mentorship, and support to team members",
          "Lead and participate in agile development methodologies, ensuring timely delivery of high-quality software solutions",
          "Develop software solutions by studying information needs; conferring with users; studying systems flow, data usage and work processes; investigating problem areas",
          "Participate in the Agile software development from concept, design to full-stack coding and testing",
          "Document and demonstrate solutions by developing documentation, flowcharts, layouts, diagrams, charts, code comments and clear code",
          "Stay current on development tools, programming techniques and computing equipment; participating in educational opportunities; reading professional publications;",
          "Provide senior level support in project, ad hock status / issues meetings and conference calls",
          "Provide technical expertise, guidance, coaching, training and educational opportunities to assist team members in closing performance and skill set gaps in order for them to advance",
          "Mentor software development team",
          "Make informed decisions quickly and take ownership of services and applications at scale",
          "Create internal process improvement initiatives within team's toolsets and workflows",
          "Perform code reviews",
          "Provide operational support as needed",
          "Lead the design and development of complex software projects",
          "Collaborate with product managers, designers, and other stakeholders to understand requirements and deliver innovative software solutions",
          "Analyze complex technical problems and propose creative solutions",
          "Troubleshoot issues and collaborate with team members to resolve challenges",
          "Contribute to the development of the technology roadmap, aligning technical strategies with business objectives",
          "Assess technical risks and develop mitigation strategies",
          "Advocate for user-centric design and ensure that software solutions meet or exceed customer expectations",
          "Other duties as assigned"
        ]
      },
      "job_job_title": null,
      "job_posting_language": null,
      "job_onet_soc": "15113200",
      "job_onet_job_zone": "4",
      "job_occupational_categories": null,
      "job_naics_code": null,
      "job_naics_name": null
    }
  ]
}


Additional info


API Overview

JSearch by OpenWeb Ninja is a fast, reliable, and comprehensive jobs API. As the most comprehensive and maintained option available, JSearch empowers you to seamlessly access most-up-to-date job postings and salary information in real-time from Google for Jobs - the largest job aggregate on the web.

For high volume / large scale plans, please check the JSearch (Mega) API or contact us on support@openwebninja.com.

Do you need help with API integration in your projects?

    Email us: support@openwebninja.com
    Chat with us live on Discord: https://discord.gg/wxJxGsZgha

👉 Like our API and service? Drop us a review on Trustpilot, G2, or Gartner Peer Insights and we'll be happy to give 20% off any standard plan as a gesture of our appreciation.

Fast and Reliable Job Searches on All Public Job Sites: LinkedIn, Indeed, Glassdoor, ZipRecruiter, and Others in Real-Time from Google for Jobs.
Introduction

The OpenWeb Ninja JSearch API offers a fast, reliable, and comprehensive real-time job postings data and salary data from Google for Job - the largest job aggregate on the web. The API sources job postings and salary data from LinkedIn, Indeed, Glassdoor, ZipRecruiter, Monster + all public job sites on the web.

The API supports several options and filters, including filtering by posting date, job title, location, remote jobs, job requirements, employer, and many other options. Each job posting includes 40+ job data points, including job title, job description, required experience, education, skills, job location, job expiration, and many other details.

For high volume / large scale plans, please check the JSearch (Mega) API or contact us on support@openwebninja.com.

See it in action here: https://google.com/search?gl=us&ibp=htl;jobs&q=marketing+in+texas.
Getting Started

To begin using JSearch API, follow these steps and make your first API call:

    Subscribe to a plan: Visit our Pricing page and subscribe to one of the plans. If you are just starting, you can subscribe to the free BASIC plan of the API with 200 free monthly requests (hard-limited and no credit card required).

    Make your first API call: Visit the RapidAPI Playground - the Search endpoint should be selected and displayed on the main panel view. Since there is already a default query parameter value, just click the blue "Test endpoint" button to make a your first API call. The JSON response will be displayed on the right panel.

    Documentation and Resources: Refer to the detailed endpoint, parameter descriptions, and examples provided in the Endpoints tab under each endpoint. Code snippets are available for all popular programming languages and environments, including - Javascript, Python, Java, Shell, and many others, to help you easily integrate the API into your project or workflow.

You should be good to go now!
Authentication

To authenticate with the API, send the X-RapidAPI-Host header with a value of “jsearch.p.rapidapi.com” along with the X-RapidAPI-Key header set with your RapidAPI App API Key (as shown in the endpoint Code Snippets).
Response Structure

All JSON response bodies returned by our API backend have the following fields: status (ERROR or OK), request_id, and either error (including message and code fields), if the request failed and data field otherwise.

Here’s an example of a successful response:

{
    "status": "OK",
    "request_id": "53345b8a-de21-40c7-9ec7-b5842796c526",
    "data": {..} or [..] 
}

Here’s an example of an error response:

{
    "status": "ERROR",
    "request_id": "408a33ea-77f5-4a21-94e5-8b5884da6bb1",
    "error": {
        "message": "Limit should be an integer between 1-500.",
        "code": 400
    }
}

Please note that some errors might be returned by the RapidAPI gateway and will have a different structure. Please refer to the Error Handling / Error Response Structure section for more details.

In addition, RapidAPI gateway adds several headers to each response, for more information, please refer to https://docs.rapidapi.com/docs/response-headers.
Endpoints

For detailed endpoint parameters and responses documentation and examples, and to try the API, please refer to the Endpoints section of the API.
Job Search
GET /search

Search for jobs posted on any public job site across the web on the largest job aggregate in the world (Google for Jobs). Extensive filtering support and most options available on Google for Jobs.
Job Details
GET /job-details

Get all job details by id. Details including all job details returned by the Search endpoint in addition to employer reviews, additional application options / links, and estimated salaries for similar jobs.
Job Salary
GET /estimated-salary

Get salary/pay estimates for a job title (e.g. Node Developer) around a location (e.g. San Francisco, CA, US).
Company Job Salary
GET /company-job-salary

Get salary/pay in a specific company per job title (e.g. Node Developer) and optionally a location (e.g. San Francisco, CA, US).
Rate Limiting
Limits

Each subscription plan of the API defines the maximum number of requests permitted per month or the quota, in addition to a rate limit expressed in RPS (Requests Per Second).

Please note that all free plans of the API (e.g. BASIC) are rate limited to 1000 requests per hour. This is a RapidAPI requirement for any free plan.
Rate Limits Headers

All API responses include rate limit information in the following headers:

    x-ratelimit-requests-limit: number of requests the plan you are currently subscribed to allows you to make before incurring overages.
    x-ratelimit-requests-remaining: The number of requests remaining (from your plan) before you reach the limit of requests your application is allowed to make. When this reaches zero, you will begin experiencing overage charges. This will reset each day or each month, depending on how the API pricing plan is configured. You can view these limits and quotas on the pricing page of the API in the API Hub.
    x-ratelimit-requests-reset: Indicates the number of seconds until the quota resets. This number of seconds would at most be as long as either a day or a month, depending on how the plan was configured.

Handling Limits

When hitting the rate limits of the API, the RapidAPI gateway will return a 429 Too Many Requests error. When that happens, wait until your rate limit resets, or consider upgrading your subscription plan for a higher limit. We can support almost any monthly quota and rate limit, contact us for more information.

Here’s an example of a 429 Too Many Requests error:

{
    "message":"Too many requests"
}

Code Examples

Code examples are available for all popular programming languages and environments (Javascript, Python, Java, Shell, etc) on the Endpoints tab, on the right panel, under “Code Snippets”.
Common Use Cases

The OpenWeb Ninja JSearch API can be used for a variety of use cases, including:

    Job Pricing Analysis
    Lead Generation & Account-Based Marketing (ABM)
    Salary Benchmarking
    Job Board Apps, Services, and Sites.
    Jobs SEO

Error Handling

The JSearch API is designed to provide robust and reliable access to search data. However, in the event of errors during API interaction, we use HTTP status codes to indicate the nature of the problem. Below, you'll find detailed explanations of common error codes you may encounter, along with potential causes and suggested remediation steps.
Common HTTP Status Codes

    400 Bad Request: This status is returned when your request is malformed or missing some required parameters. The response body might also include a “message” field, explaining the specific error. Ensure that all required fields are included and properly formatted before retrying your request.

    403 Forbidden: This error indicates that you are not subscribed to the API or that your API key is invalid. If you believe this is in error, please contact RapidAPI support - support@rapidapi.com.

    404 Not Found: This status is returned if the requested resource could not be found. This can occur with incorrect URL endpoints. Double-check the URL and try again.

    429 Too Many Requests: This error means you have hit the rate limit for your subscription plan. Wait until your rate limit resets, or consider upgrading your subscription plan for a higher limit. If you believe this is in error, please contact us.

    5XX Server Error (500, 502, and 503): This indicates a problem with our servers processing your request or an internal server timeout. This is a rare occurrence and should be temporary. If this error persists, please contact our technical support for assistance.

Error Response Structure

Errors returned by our API backend will have a message and potentially other details attached to them to help you understand and resolve issues. Here’s an example of an error response:

{
    "status": "ERROR",
    "request_id": "35dabdcd-b334-4600-afbc-d654b8af91cf",
    "error": {
        "message": "Missing query",
        "code": 400
    }
}

Some errors like 429 Too Many Requests, 403 Forbidden, or 404 Not Found, might be returned from RapidAPI gateway, in that case, the structure will be different. Here’s an example of an error response:

{
  "message": "You are not subscribed to this API."
}

Handling Errors Programmatically

Implement error handling in your application to manage these responses gracefully. Here are some tips:

    Retry Logic: For 5XX (500, 502, 503) and 429, implement a retry mechanism that waits for a few seconds before retrying the request.

    Validation: Prior to sending requests, validate parameters to catch common errors like 400 Bad Request.

    Logging: Log error responses for further analysis to understand patterns or recurring issues that might require changes in how you integrate with the API. The request_id field in the response can be used for further debugging.

Support

If you encounter any issues that you are unable to resolve, or if you need further clarification on the errors you are seeing, please do not hesitate to contact us (see the Contact Us section below). Provide us with the error code, message, and the context in which the error occurred, and we will assist you promptly.
Contact Us

For custom plans / high tier plans, custom services or any other subject, feel free to drop us a private message or an email and we will get back to you shortly.

    Email: support@openwebninja.com
    Discord: https://discord.gg/wxJxGsZgha
    LinkedIn: https://www.linkedin.com/company/openwebninja-api

Popular OpenWeb Ninja APIs 👉

    ✅ Local Business Data - Fast, Reliable, and Extensive Local Business & POI Data - Address, Website, Phone, Email, Rating & Reviews, and 40+ More Data Points from Google Maps in Real-Time.
    ✅ Real-Time Amazon Data - Fast and Reliable Product Searches, Reviews, Offers, Best Sellers, Deals, Seller Data, Influencers Data, and more on Amazon in Real-Time.
    ✅ Local Business Search - Fast, Reliable, and Comprehensive Business Search - Phone, Email, Address, Website, Rating, Reviews, and 40+ More Data Points from Google Maps in Real-Time.
    ✅ JSearch - Fast and Reliable Job Searches on All Public Job Sites: LinkedIn, Indeed, Glassdoor, ZipRecruiter, and Others in Real-Time from Google for Jobs.
    ✅ Real-Time Product Search - Fast and Reliable Product Searches, Product Offers, Sponsored Products, and Reviews on Google Shopping - the Largest and Most Extensive Product Data Aggregate on the Internet.
    ✅ Real-Time Web Search - Ultra-Fast, Scalable, and Reliable Google Web Search & Organic SERP API, AI Overviews, AI Mode, and More in Real-Time.
    ✅ Real-Time News Data - Get Top News Articles Globally, Per Topic & Section or Search Local News from Google News Feed and The Web in Real-Time.
    ✅ Real-Time Image Search - Fast and Reliable Real-Time Image Searches on Google Images (SERP).
    ✅ Copilot - Fast and Reliable Microsoft Copilot API (Unofficial), Utilizing OpenAI's Latest GPT-5 Model with Bing Web Search, Web Browsing Capabilities, and Continuous Conversations Support as available on copilot.microsoft.com.
    ✅ Real-Time Finance Data - Get Stock, Index, Market Quotes and Trends, ETF, International Exchanges / Forex, Crypto, Related News and Analytics in Real-Time from Google Finance & Other Sources.
    ✅ Real-Time Lens Data - Search by Image on Google Lens - Get Visual Matches, Products, Exact Matches, Text (OCR), Homework, Knowledge Graph, QR Code Info, and More.
    ✅ Web Search Autocomplete - Fast and Reliable Web Search Autocomplete / Typeahead (Unofficial Google Search Autocomplete API).
    ✅ Store Apps - Fast, Reliable, and Extensive Google Play Store Apps & Games (Android) Search, Top Charts, Including Extensive App Details and Reviews in Real-Time.
    ✅ Website Contacts Scraper - Fast and Reliable Extraction of Emails, Phone Numbers, and Social Links from a Website Domain in Real-Time (Facebook, TikTok, Instagram, Twitter, and others).
    ✅ Real-Time Events Search - Search Local & Online Events such as Concerts, Sports Matches & Events, Workshops, Festivals, Movies and More on Google in Real-Time.
    ✅ Reverse Image Search - Fast and Reliable Reverse Image Searches - Find the Sources of an Image and Referencing Web Pages in Real-Time, including price, availability, and more data points.
    ✅ Trustpilot Company and Reviews Data - Fast and Reliable Company / Business Searches, Reviews, and more from Trustpilot in Real-Time (unofficial API).
    ✅ Real-Time Real-Estate Data - Fast and Reliable Real-Estate Data for the U.S. and Canada - Search Properties by Address or Coordinates, Get Full Property Details, Property Estimated Market Valuations, and More from Popular Real-Estate Platforms in Real-Time.
    ✅ Local Rank Tracker - Track Google My Business / GMB & Google Maps Ranking Across a Local Area - Broken Into a Local Search Grid.
    ✅ Red Flower Business Data - Fast and Reliable Local Business / Restaurants Searches and Customer Reviews on Yelp in Real-Time (unofficial).
    ✅ Waze - Get Alerts, Traffic Jams Information, and Driving Directions from Waze / Google in Real-Time.
    ✅ Real-Time Glassdoor Data - Get and Search Company Data, Jobs, Employer Reviews, Salaries, Interviews, and More from Glassdoor in Real-Time (unofficial API).
    ✅ EV Charge Finder - Fast and Reliable EV Charging Station Searches, Anywhere in the World, Including Connector Availability, Types and Power information / Options.
    ✅ Real-Time Forums Search - Fast and Reliable Google Forums Searches Across the Web in Real-Time (Reddit, Quora, Stack Overflow, etc).
    ✅ Google AI Mode - Fast and Reliable Google AI Mode Search Results Powered by Gemini 2.5's Advanced Reasoning, Thinking, and Multimodal Capabilities with Web Access and Continuous Conversation support.
    ✅ Real-Time Walmart Data - Fast and Reliable Product Searches, Product Reviews, Offers, Extensive Product Details, and More on Walmart in Real-Time.
    ✅ Real-Time eBay Data - Fast, Reliable, and Extensive eBay Data API - Search Products, List Products by Category, Get Seller Feedback / Product Reviews, and More from 20 eBay Domains Worldwide in Real-Time.
    ✅ Real-Time Costco Data - Fast, Reliable, and Comprehensive Product Searches on Costco US and Canada in Real-Time.
    ✅ Company Data - Fast and Reliable, All-In-One Company Data Including Ratings & Reviews, Revenue, Stock, Locations, Competitors, Size, Salaries, Interviews, and Additional Data.
    ✅ AI Overviews - Fast and Reliable Google AI Overviews Results - Get Structured Reply Including Text, Links, Videos, and More in Real-Time.
    ✅ Real-Time Shorts Search - Fast and Reliable Short Video Searches on Google and Across the Web in Real-Time (YouTube Shorts, TikTok, and Instagram Reels)
    ✅ Real-Time Books Data - Fast and Reliable Book, Newspaper, and Magazine Searches on Google Books in Real-Time.
    ✅ ElevenLabs Sound Effects - Converts text into sounds & uses the most advanced AI audio model ever to create sound effects for your videos, voice-overs or video games.
    ✅ Fact Checker - Fast and Reliable Fact Check Search - Validate Facts About a Person or Topic using Google Trusted Web Sources in Real-Time
    ✅ Driving Directions - Get Driving Directions and Best Routes from an Origin to a Destination in Real-Time, from Google Maps.
    ✅ Job Salary Data - Fast and Reliable Job Salary / Pay Estimation by Job Title and Location on Glassdoor in Real-Time.
    ✅ Email Search - Get emails found on the web for a given query and an email domain in real-time.
    ✅ Email Finder - Find The Email Address of a Professional - e.g. John Doe @ company.com on the Web.
    ✅ Social Links Search - Search for Social Profile Links on the Web in Real-Time - including Facebook, TikTok, Instagram, Snapchat, Twitter, LinkedIn, Youtube channels, Pinterest and Github.
    ✅ Real-Time Dataset Search - Search 25 Million+ Datasets in Thousands of Repositories Across the Web on Google Dataset Search in Real-Time.
    ✅ Gemini - Fast and Reliable Unofficial Google Gemini API Providing Google’s Cutting-Edge Gemini Model with Advanced Reasoning and Web Access.
    ✅ ChatGPT - Fast and Reliable Unofficial ChatGPT API Providing Latest OpenAI's Cutting-Edge GPT-5 Model with Advanced Reasoning and Web Access.
    ✅ Web Unblocker - Fetch the HTML of a Website With Our Ultra-Scalable, Reliable, and Stealthy Scraper API. Includes JavaScript Rendering, Rotating Proxies, and Smart Retries.

---

## Vendor 3: Jobs API

### Endpoint (listing / playground URL)
API endpoint https://rapidapi.com/Pat92/api/jobs-api14/playground/apiendpoint_bded5d4e-0eea-48dd-8562-d749fea97c42

### Query Params
Query Params
datePosted
(optional)
String

Optional

The maximum age of when a result was added to LinkedIn, will return everything by default.

Allowed values

month, week or day
workplaceTypes
(optional)
String

Optional

Filter by workplace-types, like remote, hybrid, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.

Allowed values

remote, hybrid or onSite separated by a semicolon (;)
organizationIds
(optional)
String

Optional

ID of organizations like companies and schools the job-postings should be from, use the Search and list organization IDs endpoint for valid IDs. Will return everything by default.

Allowed format

^\d+(;\d+)*;?$
query
(optional)
String

Optional

Keywords, job-title, company-name, position or any other relevant search-query.
experienceLevels
(optional)
String

Optional

Filter by experience-levels, like intern, director, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.

Allowed values

intern, entry, associate, midSenior or director separated by a semicolon (;)
location
(optional)
String

Optional

Location of the job offer, like country or city. Will be Worldwide if empty.
token
(optional)
String

Optional

Pagination token from previous response as the meta.nextToken to get the next batch of results.
employmentTypes
(optional)
String

Optional

Filter by job-types, like fulltime, contractor, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.

Allowed values

contractor, fulltime, parttime, intern or


### Sample request
Sample request

curl --request GET \
	--url 'https://jobs-api14.p.rapidapi.com/v2/linkedin/search?datePosted=month&workplaceTypes=remote%3Bhybrid%3BonSite&organizationIds=1441&query=java&experienceLevels=intern%3Bentry%3Bassociate%3BmidSenior%3Bdirector&location=Worldwide&employmentTypes=contractor%3Bfulltime%3Bparttime%3Bintern%3Btemporary' \
	--header 'Content-Type: application/json' \
	--header 'x-rapidapi-host: jobs-api14.p.rapidapi.com' \
	--header 'x-rapidapi-key: '


### Sample JSON
Sample json


{
  "_links": {
    "next": "/v2/linkedin/search?token=dD0xMDtxPXJlYW...",
    "self": "/v2/linkedin/search?query=react"
  },
  "data": [
    {
      "companyName": "Netflix",
      "datePosted": "2025-12-18",
      "id": "4344905017",
      "linkedinCompanyName": "netflix",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/hr-coordinator-netflix-animation-studios-at-netflix-4344905017",
      "location": "Burbank, CA",
      "postedTimeAgo": "2 weeks ago",
      "title": "HR Coordinator - Netflix Animation Studios"
    },
    {
      "companyName": "Prospect Equities®",
      "datePosted": "2025-12-10",
      "id": "4342895176",
      "linkedinCompanyName": "prospect-equities-",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/front-end-developer-intern-at-prospect-equities%C2%AE-4342895176",
      "location": "Chicago, IL",
      "postedTimeAgo": "3 weeks ago",
      "title": "Front-End Developer Intern"
    },
    {
      "companyName": "LinkedIn",
      "datePosted": "2025-12-17",
      "id": "4344456572",
      "linkedinCompanyName": "linkedin",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/software-engineer-frontend-at-linkedin-4344456572",
      "location": "Mountain View, CA",
      "postedTimeAgo": "2 weeks ago",
      "title": "Software Engineer - Frontend"
    },
    {
      "companyName": "Notion",
      "datePosted": "2025-12-19",
      "id": "4334367155",
      "linkedinCompanyName": "notionhq",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/software-engineer-fullstack-early-career-at-notion-4334367155",
      "location": "New York, NY",
      "postedTimeAgo": "2 weeks ago",
      "title": "Software Engineer, Fullstack, Early Career"
    }
  ],
  "errors": [],
  "hasError": false,
  "hasWarning": false,
  "meta": {
    "count": 10,
    "nextToken": "dD0xMDtxPXJlYW...",
    "position": 0
  },
  "warnings": []
}


### Endpoint (listing / playground URL)
endpoint https://rapidapi.com/Pat92/api/jobs-api14/playground/apiendpoint_1f412852-3344-45c4-a777-e1a4f22c2f09

### Query Params
Query Params
id
*
String

Required

ID of the job, to get allowed values, use the search endpoint.

Allowed format

^\d+$

### Example request
example request

curl --request GET \
	--url https://jobs-api14.p.rapidapi.com/v2/linkedin/get \
	--header 'Content-Type: application/json' \
	--header 'x-rapidapi-host: jobs-api14.p.rapidapi.com' \
	--header 'x-rapidapi-key: '

### Example response
Example response

{
  "_links": {
    "self": "/v2/linkedin/get?id=4344905017"
  },
  "data": {
    "acceptingApplications": true,
    "applicants": 200,
    "companyName": "Netflix",
    "description": "Netflix Animation Studios is on a mission...",
    "employmentType": "Full-time",
    "id": "4344905017",
    "industries": "Entertainment Providers",
    "jobFunction": "Other",
    "linkedinCompanyName": "netflix",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/hr-coordinator-netflix-animation-studios-at-netflix-4344905017",
    "location": "Burbank, CA",
    "postedTimeAgo": "2 weeks ago",
    "seniorityLevel": "Not Applicable",
    "title": "HR Coordinator - Netflix Animation Studios"
  },
  "errors": [],
  "hasError": false,
  "hasWarning": false,
  "warnings": []
}

### Additional info
Additional info

API Overview
Introduction

The Jobs API provides a unified way to search, discover, and access job postings from multiple leading platforms. Instead of manually integrating different job boards, this API brings them together under one consistent structure, making it easier for developers, recruiters, and data-driven applications to find and analyze employment opportunities.

Currently, the API supports job listings from LinkedIn, Bing Jobs, and Xing (with more providers to follow). Each job board offers:

    A search endpoint to query jobs by keywords, location, filters, and other parameters.
    A get endpoint to retrieve detailed information about a specific job posting using its ID.

This design allows you to quickly find relevant jobs and then fetch complete details, such as job descriptions, company information, salary ranges, and application links.
Why This API Is Useful

The Jobs API is built to serve a wide range of use cases:

    Recruiters & HR Platforms – Aggregate jobs from multiple sources into a single feed to discover talent opportunities faster.
    AI & ML Companies – Train models on real job market data to analyze trends, skill demand, or generate personalized job recommendations.
    Job Aggregators & Career Portals – Quickly expand offerings by pulling listings from multiple providers without building and maintaining custom scrapers.
    Market Researchers & Analysts – Track hiring activity, salary benchmarks, and demand for specific roles or skills across different regions.
    Personal Career Assistants – Power chatbots or personal apps that deliver tailored job suggestions based on a user’s profile.

Benefits

    Unified structure – Standardized responses across different job boards.
    Global reach – Combine international sources like LinkedIn and Bing with regional platforms like Xing (focused on the German-speaking market).
    Detailed filtering – Search by location, job type, career level, salary range, or workplace type (remote, hybrid, on-site).
    Scalable – Pagination and structured endpoints make it suitable for production use in large-scale applications.

With more job boards being added over time, the Jobs API continues to grow into a comprehensive hub for job discovery and employment data.

The **Jobs API** makes it easy to find job postings from multiple platforms in one place. Instead of integrating LinkedIn, Bing Jobs, and Xing separately, you can access them all through a single, unified API. With simple search and detail endpoints, you can quickly discover relevant jobs and retrieve full descriptions, salaries, company info, and application links. Perfect for recruiters, job boards, AI apps, and career tools, the Jobs API helps you: - Aggregate jobs across major platforms - Power personalized job recommendations - Analyze hiring trends and skill demand - Build smarter recruitment and career solutions

Open in Postman

Use the Open in Postman button above to access the collection.

To load the collection in Postman:

    Open Postman and click Import.
    Either:
        Paste the collection URL directly, or
        Open the link in your browser, right-click the page, and save the content as a JSON file, then import that file into Postman.

After importing, open the collection’s Variables tab and replace the x-rapidapi-key with your own credentials.
Jobs API

This API allows you to discover employment opportunities from various providers, as well as income information.
Table of contents

    1 Job search Bing
        1.1 Search and list jobs
        1.2 Get job details
    2 Job search Indeed
        2.1 Search and list jobs
    3 Job search LinkedIn
        3.1 Search and list jobs
        3.2 Get job details
        3.3 Search and list organization IDs
    4 Job search Xing
        4.1 Search and list jobs
        4.2 Get job details
    5 Salary range
        5.1 Get job titles
        5.2 Get job salaries
    6 Errors and warnings
        6.1 Errors
        6.2 Warnings

1 Job search Bing
1.1 Search and list jobs

Get a list of jobs, use the /v2/bing/get for more information on a specific job.

URL: /v2/bing/search
Request parameters
key	type	allowedValues	description	isRequired	example
query	string	-	Optional
Keywords, job-title, company-name, position or any other relevant search-query.	false	Java
location	string	-	Required if token is not set
Location of the job offer, like country or city in any combination.	true	Switzerland
datePosted	string	week, day or empty	Optional
The maximum age of when a result was added to Bing, will return everything by default.
Allowed values
week, day or empty	false	week
employmentTypes	string	contractor, fulltime, parttime or temporary	Optional
Filter by job-types, like fulltime, contractor, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything if not set.
Allowed values
contractor, fulltime, parttime or temporary separated by a semicolon (;)	false	contractor;fulltime;parttime;temporary
remoteOnly	boolean	true or false	Optional
Boolean to get only remote-jobs, will default to false if not set.
Allowed values
true or false	false	false
token	string	-	Optional
Pagination token from previous response as the meta.nextToken to get the next batch of results.	false	
Request example

/v2/bing/search?location=zurich&query=java&datePosted=day

### Example response
Example response

{
  "data": [
    {
      "company": "ETHjuniors",
      "employmentType": "Full-time",
      "id": "LTg3NDcyOTQ2Mi5SZXRybw==",
      "image": "https://th.bing.com/th/id/OJA.-1678676695NS?w=24&h=24&o=6&pid=JobAns",
      "jobProvider": "Jobrapido",
      "location": "Zug, ZG",
      "postedTimeAgo": "6 November",
      "title": "Flutter Developer"
    },
    {
      "company": "ETHjuniors",
      "employmentType": "",
      "id": "LTE0OTkxMjc1MDUuUmV0cm8=",
      "image": "https://th.bing.com/th/id/OJA.-1678676695NS?w=24&h=24&o=6&pid=JobAns",
      "jobProvider": "Bebee::Jobrapido",
      "location": "Zug, ZG",
      "postedTimeAgo": "6 November",
      "title": "Flutter Developer"
    },
    {
      "company": "Circleup",
      "employmentType": "Full-time",
      "id": "NzMzOTA3MzkyLlJldHJv",
      "image": "",
      "jobProvider": "Jobrapido",
      "location": "Bern, BE",
      "postedTimeAgo": "17 October",
      "title": "Lead Full-Stack SW Engineer & Partner (Base Salary & Equity) - (Django & Flutter/React)"
    },
    {
      "company": "Pixel Plus AG",
      "employmentType": "",
      "id": "NjY1NTMzMDQzLlJldHJv",
      "image": "https://th.bing.com/th/id/OJA.1654796514NS?w=24&h=24&o=6&pid=JobAns",
      "jobProvider": "Bebee",
      "location": "ZH",
      "postedTimeAgo": "1 day ago",
      "title": "Flutter Developer For Finance App"
    }
  ],
  "meta": {
    "position": 0,
    "count": 18,
    "nextToken": "dD0yNDhDMkM1OTc.."
  },
  "_links": {
    "self": "/v2/bing/search?location=switzerland&query=flutter",
    "next": "/v2/bing/search?token=dD0yNDhDMkM1OTc.."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

Pagination

To get the next batch of results the meta.nextToken from the response can be used. For how the request should look, the _links.next gives an example.

Generally the other URL-parameters can be left out if the token is set, but it will work even when the other parameters are present.
nextToken example from response:

{
  "data": [],
  "meta": {
    "nextToken": "dG9rZW49ODY5ODU..."
  },
  "_links": {
    "next": "/v2/bing/search?token=dG9rZW49ODY5ODU..."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

token example request:

/v2/bing/search?token=dG9rZW49ODY5ODU...
1.2 Get job details

Get job details by its ID, use the /v2/bing/search endpoint to search for jobs and get valid IDs.

URL: /v2/bing/get
Request parameters
key	type	allowedValues	description	isRequired	example
id	string	-	Required
ID of the job, to get allowed values, use the /v2/bing/search endpoint.	true	
Request example

/v2/bing/get?id=MTEyNDYwODI1Mi5SZXRybw==

### Example response
Example response

{
  "data": {
    "applyUrl": "https://ch.linkedin.com/jobs/view/senior-mobile-software-engineer-–-fokus-flutter-und-android-at-ti-m-4268105808?trk=bingjobs",
    "companyName": "ti&m",
    "description": "Job description Werde Teil unserer Organisation...",
    "descriptionHtml": "<div><h3>Job description</h3></div><div><em>Werde Teil unserer Organisation...",
    "employmentType": "Part-time",
    "id": "LTE0OTY4MTM0NDIuUmV0cm8=",
    "location": "Zürich, ZH",
    "postedTimeAgo": "15 July",
    "title": "Senior Mobile Software Engineer – Fokus Flutter Und Android"
  },
  "_links": { "self": "/v2/bing/get?id=LTE0OTY4MTM0NDIuUmV0cm8=" },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

2 Job search Indeed
2.1 Search and list jobs

Get a list of job from Indeed.

URL: /v2/indeed/search
Request parameters
key	type	allowedValues	description	isRequired	example
query	string	-	Optional
Keywords, job-title, company-name, position or any other relevant search-query.	false	Java
location	string	-	Optional
Location of the job offer, like city, towns or provinces.	false	Zurich
countryCode	string	-	Required if token is not set
Parameter to get the titles for the required county.
Allowed format
^[A-Za-z]{2}$	true	ch
sortType	string	relevance or date	Optional
Sorting of the results, can either be by relevance or by date, will be set to relevance by default.
Allowed values
relevance or date	false	relevance
radius	integer	-	Optional
Distance of the job offers from the location.
Allowed format
^[0-9]+$	false	20
radiusType	string	km or miles	Optional
Type of the distance, can either be km or miles, will be set to km by default.
Allowed values
km or miles	false	km
token	string	-	Optional
Pagination token from previous response as the meta.nextToken to get the next batch of results.	false	
Request example

/v2/indeed/search?location=zurich&query=java&countryCode=ch

### Example response
Example response

{
  "data": [
    {
      "applyUrl": "https://click.appcast.io/t/Jo4WXZskvtPZ9WgFwqnpCUVCv-vN0fkkJ6ip_S65XSY=",
      "company": {
        "addresses": ["Bethesda, MD"],
        "image": "https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/256x256/debbff68624041821d0c56fbccbcc330",
        "name": "Lockheed Martin"
      },
      "dateOnIndeedTimestamp": -2023594907,
      "datePublishedTimestamp": -749158656,
      "description": "Job ID: 691465BR\nDate posted: Nov. 30, 2025...",
      "id": "56a1b7550fa78bba",
      "location": {
        "country": "United States",
        "countryCode": "US",
        "location": "King of Prussia, PA"
      },
      "title": "Java Software Engineer III"
    },
    {
      "applyUrl": "https://click.appcast.io/t/q7vuN9iOmz3dRG2xAe7KoxP7I6Z7SQdG-wpiMdJf9nw=",
      "company": {
        "addresses": ["Bethesda, MD"],
        "image": "https://d2q79iu7y748jz.cloudfront.net/s/_squarelogo/256x256/debbff68624041821d0c56fbccbcc330",
        "name": "Lockheed Martin"
      },
      "dateOnIndeedTimestamp": -2023595367,
      "datePublishedTimestamp": -749158656,
      "description": "Job ID: 698997BR\nDate posted: Nov. 30, 2025...",
      "id": "6c588ac5af1876cc",
      "location": {
        "country": "United States",
        "countryCode": "US",
        "location": "King of Prussia, PA"
      },
      "title": "Java Software Engineer III- Space Mission Applications"
    },
    {
      "applyUrl": "https://click.appcast.io/t/TgmDjYI9cOSltDS4D0tQ4RxKivariwQLFIXeX5CIrPk=",
      "company": { "addresses": [], "image": "", "name": "GEICO" },
      "dateOnIndeedTimestamp": -2023807598,
      "datePublishedTimestamp": -2106525952,
      "description": "At GEICO, we offer a rewarding career...",
      "id": "5f9b5f874e6ab3a5",
      "location": {
        "country": "United States",
        "countryCode": "US",
        "location": "Chevy Chase, MD"
      },
      "title": "Staff Engineer - Applied AI"
    },
    {
      "applyUrl": "https://click.appcast.io/t/oP7qQFlODRAEfszK6tVzUXyMH5xMSoExd3UgIeLXVRQ=",
      "company": { "addresses": [], "image": "", "name": "GEICO" },
      "dateOnIndeedTimestamp": -2023808358,
      "datePublishedTimestamp": -2106525952,
      "description": "At GEICO, we offer a rewarding career...",
      "id": "2bcbfe330ed5c52f",
      "location": {
        "country": "United States",
        "countryCode": "US",
        "location": "New York, NY"
      },
      "title": "Senior Staff ML Engineer, Fraud Risk Modeling"
    }
  ],
  "meta": {
    "position": 0,
    "count": 20,
    "nextToken": "dD1BQlFBQVFBVUFBQUFBQ..."
  },
  "_links": {
    "self": "/v2/indeed/search?countryCode=us&query=java",
    "next": "/v2/indeed/search?token=dD1BQlFBQVFBVUFBQUFBQ..."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

Pagination

To get the next batch of results the meta.nextToken from the response can be used. For how the request should look, the _links.next gives an example.

Generally the other URL-parameters can be left out if the token is set, but it will work even when the other parameters are present.
nextToken example from response:

{
  "data": [],
  "meta": {
    "nextToken": "dG9rZW49ODY5ODU..."
  },
  "_links": {
    "next": "/v2/indeed/search?token=dG9rZW49ODY5ODU..."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

token example request:

/v2/indeed/search?token=dG9rZW49ODY5ODU...
3 Job search LinkedIn
3.1 Search and list jobs

Get a list of jobs, use the /v2/linkedin/get for full details on a specific job.

URL: /v2/linkedin/search
Request parameters
key	type	allowedValues	description	isRequired	example
query	string	-	Optional
Keywords, job-title, company-name, position or any other relevant search-query.	false	java
organizationIds	string	-	Optional
ID of organizations like companies and schools the job-postings should be from, use the Search and list organization IDs endpoint for valid IDs. Will return everything by default.
Allowed format
^\d+(;\d+)*;?$	false	1441
location	string	-	Optional
Location of the job offer, like country or city. Will be Worldwide if empty.	false	Worldwide
datePosted	string	month, week or day	Optional
The maximum age of when a result was added to LinkedIn, will return everything by default.
Allowed values
month, week or day	false	month
employmentTypes	string	contractor, fulltime, parttime, intern or temporary	Optional
Filter by job-types, like fulltime, contractor, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.
Allowed values
contractor, fulltime, parttime, intern or temporary separated by a semicolon (;)	false	contractor;fulltime;parttime;intern;temporary
experienceLevels	string	intern, entry, associate, midSenior or director	Optional
Filter by experience-levels, like intern, director, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.
Allowed values
intern, entry, associate, midSenior or director separated by a semicolon (;)	false	intern;entry;associate;midSenior;director
workplaceTypes	string	remote, hybrid or onSite	Optional
Filter by workplace-types, like remote, hybrid, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.
Allowed values
remote, hybrid or onSite separated by a semicolon (;)	false	remote;hybrid;onSite
token	string	-	Optional
Pagination token from previous response as the meta.nextToken to get the next batch of results.	false	
Request example

/v2/linkedin/search?query=web&location=Switzerland&datePosted=month&jobTypes=contractor;fulltime;parttime;intern;temporary&experienceLevels=intern;entry;associate;midSenior;director&workplaceTypes=remote;hybrid;onSite

### Example response
Example response

{
  "data": [
    {
      "companyName": "Netflix",
      "datePosted": "2025-12-18",
      "id": "4344905017",
      "linkedinCompanyName": "netflix",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/hr-coordinator-netflix-animation-studios-at-netflix-4344905017",
      "location": "Burbank, CA",
      "postedTimeAgo": "2 weeks ago",
      "title": "HR Coordinator - Netflix Animation Studios"
    },
    {
      "companyName": "Prospect Equities®",
      "datePosted": "2025-12-10",
      "id": "4342895176",
      "linkedinCompanyName": "prospect-equities-",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/front-end-developer-intern-at-prospect-equities%C2%AE-4342895176",
      "location": "Chicago, IL",
      "postedTimeAgo": "3 weeks ago",
      "title": "Front-End Developer Intern"
    },
    {
      "companyName": "LinkedIn",
      "datePosted": "2025-12-17",
      "id": "4344456572",
      "linkedinCompanyName": "linkedin",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/software-engineer-frontend-at-linkedin-4344456572",
      "location": "Mountain View, CA",
      "postedTimeAgo": "2 weeks ago",
      "title": "Software Engineer - Frontend"
    },
    {
      "companyName": "Notion",
      "datePosted": "2025-12-19",
      "id": "4334367155",
      "linkedinCompanyName": "notionhq",
      "linkedinUrl": "https://www.linkedin.com/jobs/view/software-engineer-fullstack-early-career-at-notion-4334367155",
      "location": "New York, NY",
      "postedTimeAgo": "2 weeks ago",
      "title": "Software Engineer, Fullstack, Early Career"
    }
  ],
  "meta": {
    "position": 0,
    "count": 10,
    "nextToken": "dD0xMDtxPXJlYW..."
  },
  "_links": {
    "self": "/v2/linkedin/search?query=react",
    "next": "/v2/linkedin/search?token=dD0xMDtxPXJlYW..."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

Pagination

To get the next batch of results the meta.nextToken from the response can be used. For how the request should look, the _links.next gives an example.

Generally the other URL-parameters can be left out if the token is set, but it will work even when the other parameters are present.
nextToken example from response:

{
  "data": [],
  "meta": {
    "nextToken": "dG9rZW49ODY5ODU..."
  },
  "_links": {
    "next": "/v2/linkedin/search?token=dG9rZW49ODY5ODU..."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

token example request:

/v2/linkedin/search?token=dG9rZW49ODY5ODU...
3.2 Get job details

Get job details by its ID, use the /v2/linkedin/search endpoint to search for jobs.

URL: /v2/linkedin/get
Request parameters
key	type	allowedValues	description	isRequired	example
id	string	-	Required
ID of the job, to get allowed values, use the search endpoint.
Allowed format
^\d+$	true	
Request example

/v2/linkedin/get?id=4175032607

### Example response
Example response

{
  "data": {
    "acceptingApplications": true,
    "applicants": 200,
    "companyName": "Netflix",
    "description": "Netflix Animation Studios is on a mission...",
    "employmentType": "Full-time",
    "id": "4344905017",
    "industries": "Entertainment Providers",
    "jobFunction": "Other",
    "linkedinCompanyName": "netflix",
    "linkedinUrl": "https://www.linkedin.com/jobs/view/hr-coordinator-netflix-animation-studios-at-netflix-4344905017",
    "location": "Burbank, CA",
    "postedTimeAgo": "2 weeks ago",
    "seniorityLevel": "Not Applicable",
    "title": "HR Coordinator - Netflix Animation Studios"
  },
  "_links": { "self": "/v2/linkedin/get?id=4344905017" },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

3.3 Search and list organization IDs

Get a list of organization IDs, use the IDs in the organizationIds in /v2/linkedin/search to filter by companies or schools.

URL: /v2/linkedin/organizations
Request parameters
key	type	allowedValues	description	isRequired	example
query	string	-	Required
Organization name or query, can be companies or schools, etc.	true	google
Request example

/v2/linkedin/organizations?query=google

### Example response
Example response

{
  "data": [
    { "displayName": "Google", "id": 1441 },
    { "displayName": "Google DeepMind", "id": 1594050 },
    { "displayName": "Google Operations Center", "id": 14547137 },
    { "displayName": "Google Fiber", "id": 2171947 },
    { "displayName": "Google for Startups", "id": 18336369 },
    { "displayName": "Google Developers Group", "id": 11162656 },
    { "displayName": "Mandiant (part of Google Cloud)", "id": 28103 },
    { "displayName": "Google Cloud Security", "id": 18451491 },
    { "displayName": "Google Summer of Code", "id": 19184331 },
    { "displayName": "Google Cloud Skills Boost", "id": 98808973 }
  ],
  "meta": { "count": 10 },
  "_links": { "self": "/v2/linkedin/organizations?query=google" },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

4 Job search Xing
4.1 Search and list jobs

Get a list of jobs, use the /v2/xing/get for more information on a specific job.

URL: /v2/xing/search
Request parameters
key	type	allowedValues	description	isRequired	example
query	string	-	Required if token is not set
Keywords, job-title, company-name, position or any other relevant search-query.	true	Java
location	string	-	Optional
Location of the job offer, like country or city in any combination - locations should be written in german, as Xing is a german speaking job-market.	false	Schweiz
datePosted	string	week, day, month or empty	Optional
The maximum age of when a result was added to Xing, will return everything by default.
Allowed values
week, day, month or empty	false	week
employmentTypes	string	contractor, fulltime, intern, parttime, seasonal, temporary or voluntary	Optional
Filter by job-types, like fulltime, contractor, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.
Allowed values
contractor, fulltime, intern, parttime, seasonal, temporary or voluntary separated by a semicolon (;)	false	contractor;fulltime;intern;parttime;seasonal;temporary;voluntary
careerLevels	string	student, entry, professional, manager, executive or seniorExecutive	Optional
Filter by career-levels, like intern, manager, etc. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.
Allowed values
student, entry, professional, manager, executive or seniorExecutive separated by a semicolon (;)	false	student;entry;professional;manager;executive;seniorExecutive
remoteOptions	string	remote, hybrid or onSite	Optional
Workplace type, like remote, hybrid or on-site. Multiple values are possible and need to be separated by semicolon (;). Will return everything by default.
Allowed values
remote, hybrid or onSite separated by a semicolon (;)	false	remote;hybrid;onSite
minimumSalary	integer	-	Optional
Minimum yearly salary for the posted jobs. Will return everything by default.
Allowed format
^[0-9]+$	false	1000
token	string	-	Optional
Pagination token from previous response as the meta.nextToken to get the next batch of results.	false	
Request example

/v2/xing/search?location=zurich&query=java&datePosted=day

### Example response
Example response

{
  "data": [
    {
      "company": "Amadeus Fire AG",
      "dateUpdated": "2026-01-03T12:05:52Z",
      "employmentType": "Full-time",
      "id": "a2Fpc2Vyc2xhdXRlcm4...",
      "image": "https://www.xing.com/imagecache/public/...",
      "location": "Kaiserslautern",
      "salary": { "currency": "EUR", "maximum": 70000, "minimum": 60000 },
      "title": "Java/Kotlin Full-Stack Entwickler (m/w/d)"
    },
    {
      "company": "Finanz Informatik GmbH & Co. KG",
      "dateUpdated": "2026-01-03T09:19:07Z",
      "employmentType": "Full-time",
      "id": "bXVlbnN0ZXItc29mdHdhcmV...",
      "image": "https://www.xing.com/imagecache/public/...",
      "location": "Münster",
      "salary": { "currency": "EUR", "maximum": 73500, "minimum": 49500 },
      "title": "Softwareentwickler (m/w/d) im Umfeld Nachwuchskunden"
    },
    {
      "company": "Finanz Informatik GmbH & Co. KG",
      "dateUpdated": "2026-01-03T09:19:06Z",
      "employmentType": "Full-time",
      "id": "bXVlbnN0ZXItamF2YS1zb2...",
      "image": "https://www.xing.com/imagecache/public/...",
      "location": "Münster",
      "salary": { "currency": "EUR", "maximum": 77500, "minimum": 49000 },
      "title": "Java Softwareentwickler (m/w/d)"
    },
    {
      "company": "Coperitus GmbH",
      "dateUpdated": "2026-01-03T09:25:04Z",
      "employmentType": "Full-time",
      "id": "Y29idXJnLXNvZnR3YXJlZW50d2lja2xlci1...",
      "image": "https://www.xing.com/assets/companies/img/default-logo_96x96.png",
      "location": "Coburg",
      "salary": { "currency": "EUR", "maximum": 65500, "minimum": 49500 },
      "title": "Softwareentwickler Java / Full-Stack Softwareentwickler Java / Softwarearchitekt (m/w/d)"
    }
  ],
  "meta": {
    "position": 0,
    "count": 4,
    "nextToken": "dD0xO3E9a290bGluO2w9O2RwPWRheTtldD07Y2w9O3JvPTttcz0w"
  },
  "_links": {
    "self": "/v2/xing/search?query=kotlin&datePosted=day",
    "next": "/v2/xing/search?token=dD0xO3E9a290bGluO2w9O2RwPWRheTtldD07Y2w9O3JvPTttcz0w"
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

Pagination

To get the next batch of results the meta.nextToken from the response can be used. For how the request should look, the _links.next gives an example.

Generally the other URL-parameters can be left out if the token is set, but it will work even when the other parameters are present.
nextToken example from response:

{
  "data": [],
  "meta": {
    "nextToken": "dG9rZW49ODY5ODU..."
  },
  "_links": {
    "next": "/v2/xing/search?token=dG9rZW49ODY5ODU..."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

token example request:

/v2/xing/search?token=dG9rZW49ODY5ODU...
4.2 Get job details

Get job details by its ID, use the /v2/xing/search endpoint to search for jobs and get valid IDs.

URL: /v2/xing/get
Request parameters
key	type	allowedValues	description	isRequired	example
id	string	-	Required
ID of the job, to get allowed values, use the /v2/xing/search endpoint.	true	
Request example

/v2/xing/get?id=MTEyNDYwODI1Mi5SZXRybw==

### Example response
Example response

{
  "data": {
    "applyUrl": "https://www.it-jobs.de/_sde-72645/...",
    "benefits": "",
    "company": "Coperitus GmbH",
    "country": "Germany",
    "countryCode": "DE",
    "dateUpdated": "2026-01-03T09:25:04Z",
    "description": "Coperitus - Unternehmen, Team und Karrieremöglichkeiten...",
    "employmentType": "EmploymentType:FULL_TIME.ef2fe9",
    "id": "Y29idXJnLXNvZnR3YXJ...",
    "location": "Coburg",
    "remoteOptions": ["PARTLY_REMOTE"],
    "responsibility": "",
    "salary": { "currency": "EUR", "maximum": 65500, "minimum": 49500 },
    "skills": "",
    "title": "Softwareentwickler Java / Full-Stack Softwareentwickler Java / Softwarearchitekt (m/w/d)"
  },
  "_links": {
    "self": "/v2/xing/get?id=Y29idXJnLXNvZnR3YXJ..."
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

5 Salary range
5.1 Get job titles

Find job titles from your query to use in /v2/salary/range.

URL: /v2/salary/titles
Request parameters
key	type	allowedValues	description	isRequired	example
query	string	-	Required
Search query for valid job titles.	true	programming
countryCode	string	-	Required
Parameter to get the titles for the required county.
Allowed format
^[A-Za-z]{2}$	true	de
Request example

/v2/salary/range?query=programming&countryCode=de

### Example response
Example response

{
  "data": {
    "jobTitles": [
      { "count": 31, "jobTitle": "software engineer" },
      { "count": 19, "jobTitle": "full stack developer" },
      { "count": 15, "jobTitle": "machine learning engineer" },
      { "count": 14, "jobTitle": "senior software engineer" },
      { "count": 13, "jobTitle": "data scientist" },
      { "count": 9, "jobTitle": "data engineer" },
      { "count": 9, "jobTitle": "r&d engineer" },
      { "count": 8, "jobTitle": "back end developer" },
      { "count": 8, "jobTitle": "senior engineer" },
      { "count": 7, "jobTitle": "ai developer" },
      { "count": 6, "jobTitle": "automation engineer" },
      { "count": 5, "jobTitle": "application developer" },
      { "count": 5, "jobTitle": "computer vision engineer" },
      { "count": 5, "jobTitle": "model" },
      { "count": 5, "jobTitle": "physicist" },
      { "count": 5, "jobTitle": "quantitative analyst" },
      { "count": 5, "jobTitle": "research engineer" },
      { "count": 5, "jobTitle": "research intern" },
      { "count": 5, "jobTitle": "senior java developer" },
      { "count": 5, "jobTitle": "student researcher" },
      { "count": 4, "jobTitle": "devops engineer" },
      { "count": 4, "jobTitle": "electronics engineer" },
      { "count": 4, "jobTitle": "engineer" },
      { "count": 4, "jobTitle": "infrastructure engineer" },
      { "count": 4, "jobTitle": "senior research engineer" }
    ]
  },
  "meta": { "count": 25 },
  "_links": { "self": "/v2/salary/titles?query=programming&countryCode=ch" },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

5.2 Get job salaries

Get salary ranges for jobs, use /v2/salary/titles to get a list of valid job titles.

URL: /v2/salary/range
Request parameters
key	type	allowedValues	description	isRequired	example
query	string	-	Required
Search query for valid job titles.	true	developer
countryCode	string	-	Required
Parameter to get the titles for the required county.
Allowed format
^[A-Za-z]{2}$	true	de
Request example

/v2/salary/range?query=developer&countryCode=de

### Example response
Example response

{
  "data": {
    "country": "Switzerland",
    "countryCode": "CH",
    "currency": "CHF",
    "dailySalary": {
      "max": 1006.060859127188,
      "mean": 849.55082984955,
      "median": 841.320182765177,
      "min": 703.555499159465
    },
    "hourlySalary": {
      "max": 81.7029013044972,
      "mean": 68.9926130955627,
      "median": 68.3241965278114,
      "min": 57.1362308637385
    },
    "lastUpdatedTimestamp": 1761956344,
    "monthlySalary": {
      "max": 9668.88383959108,
      "mean": 8164.72305340431,
      "median": 8085.62130736033,
      "min": 6761.61519888569
    },
    "weeklySalary": {
      "max": 2498.644050376289,
      "mean": 2109.937094995819,
      "median": 2089.495531067015,
      "min": 1747.344354107386
    },
    "yearlySalary": {
      "max": 136562.9666689806,
      "mean": 115318.253968254,
      "median": 114201.0237597132,
      "min": 95500.8092302153
    }
  },
  "_links": {
    "self": "/v2/salary/range?query=full%20stack%20developer&countryCode=ch"
  },
  "errors": [],
  "warnings": [],
  "hasError": false,
  "hasWarning": false
}

6 Errors and warnings

There are two types of possible issues, either you have an error, then nothing will be returned, except the error, or you have warnings then the result will be returned, but also some warnings will be set.

The fields hasError and hasWarning in the response indicate whether the response contains errors or warnings:

    hasError: This field is true if the response contains any errors. If set to false, the response has no errors.
    hasWarning: This field is true if the response contains any warnings. If set to false, the response has no warnings.

6.1 Errors
Common error Codes
code	error	message	description
400	MISSING_PARAMETER	400: Required parameter '...' is missing.	A mandatory URL-parameter is missing.
400	MISSING_OR_PARAMETER	400: Either parameter '...' or parameter '...' must to be set.	One of two URL-parameters must be set, but both are missing.
400	INVALID_PARAMETER	400: Parameter '...' contains an invalid value, valid values are ...	An invalid value has been set for an URL-parameter.
400	INVALID_PARAMETER_FORMAT	400: The value of parameter '...' does not match the expected format: ...	The format of the URL-parameter is not valid, or has the wrong type.
504	PROXY_TIMEOUT	504: Proxy timed out, please try again.	The proxy service timed-out, this usually works again after a retry.
500	UNEXPECTED_EXCEPTION	500: An unexpected error occurred.	Something happened that was not planned for.
Error response example

{
  "data": [],
  "meta": {},
  "_links": {},
  "errors": [
    {
      "code": 400,
      "error": "MISSING_OR_PARAMETER",
      "message": "400: Either parameter 'countryCode' or parameter 'token' must to be set.",
      "field": "countryCode OR token"
    },
    {
      "code": 400,
      "error": "MISSING_OR_PARAMETER",
      "message": "400: Either parameter 'query' or parameter 'token' must to be set.",
      "field": "query OR token"
    }
  ],
  "warnings": [],
  "hasError": true,
  "hasWarning": false
}

6.2 Warnings
Common warning Codes
code	error	message	description
200	UNKNOWN_PARAMETER	200: Parameter '...' is unknown and was ignored.	A unknown URL-parameter has been set, it will be ignored and the endpoint will return the result as expected.
200	NOT_RECOMMENDED_PARAMETER	200: Parameter '...' is not recommended.	A not recommended URL-parameter has been set, this message will also include a better approach.
Warning response example

{
  "data": [],
  "meta": {},
  "_links": {},
  "errors": [],
  "warnings": [
    {
      "code": 200,
      "error": "UNKNOWN_PARAMETER",
      "message": "200: Parameter 'invalidParam' is unknown and was ignored.",
      "field": "invalidParam"
    }
  ],
  "hasError": false,
  "hasWarning": true
}
