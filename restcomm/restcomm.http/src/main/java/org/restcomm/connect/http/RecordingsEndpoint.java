/*
 * TeleStax, Open Source Cloud Communications
 * Copyright 2011-2014, Telestax Inc and individual contributors
 * by the @authors tag.
 *
 * This program is free software: you can redistribute it and/or modify
 * under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation; either version 3 of
 * the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>
 *
 */
package org.restcomm.connect.http;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.thoughtworks.xstream.XStream;
import java.text.ParseException;
import java.util.ArrayList;

import java.util.List;

import static javax.ws.rs.core.MediaType.*;

import javax.annotation.PostConstruct;
import javax.servlet.ServletContext;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

import static javax.ws.rs.core.Response.*;
import static javax.ws.rs.core.Response.Status.*;
import javax.ws.rs.core.UriInfo;

import org.apache.commons.configuration.Configuration;
import org.restcomm.connect.commons.annotations.concurrency.NotThreadSafe;
import org.restcomm.connect.commons.configuration.RestcommConfiguration;
import org.restcomm.connect.http.converter.RecordingListConverter;
import org.restcomm.connect.http.converter.RestCommResponseConverter;
import org.restcomm.connect.dao.DaoManager;
import org.restcomm.connect.dao.RecordingsDao;
import org.restcomm.connect.dao.entities.Recording;
import org.restcomm.connect.dao.entities.RecordingList;
import org.restcomm.connect.dao.entities.RestCommResponse;
import org.restcomm.connect.commons.dao.Sid;
import org.restcomm.connect.dao.entities.Account;
import org.restcomm.connect.dao.entities.RecordingFilter;
import org.restcomm.connect.http.converter.RecordingConverter;

/**
 * @author quintana.thomas@gmail.com (Thomas Quintana)
 */
@NotThreadSafe
public abstract class RecordingsEndpoint extends SecuredEndpoint {
    @Context
    protected ServletContext context;
    protected Configuration configuration;
    protected RecordingsDao dao;
    protected Gson gson;
    protected XStream xstream;
    protected RecordingListConverter listConverter;
    protected String instanceId;

    public RecordingsEndpoint() {
        super();
    }

    @PostConstruct
    public void init() {
        final DaoManager storage = (DaoManager) context.getAttribute(DaoManager.class.getName());
        configuration = (Configuration) context.getAttribute(Configuration.class.getName());
        configuration = configuration.subset("runtime-settings");
        super.init(configuration);
        dao = storage.getRecordingsDao();
        final RecordingConverter converter = new RecordingConverter(configuration);
        listConverter = new RecordingListConverter(configuration);
        final GsonBuilder builder = new GsonBuilder();
        builder.registerTypeAdapter(Recording.class, converter);
        builder.registerTypeAdapter(RecordingList.class, listConverter);
        builder.setPrettyPrinting();
        gson = builder.create();
        xstream = new XStream();
        xstream.alias("RestcommResponse", RestCommResponse.class);
        xstream.registerConverter(converter);
        xstream.registerConverter(new RecordingListConverter(configuration));
        xstream.registerConverter(new RestCommResponseConverter(configuration));
        xstream.registerConverter(listConverter);

        instanceId = RestcommConfiguration.getInstance().getMain().getInstanceId();
    }

    protected Response getRecording(final String accountSid, final String sid, final MediaType responseType) {
        Account operatedAccount = accountsDao.getAccount(accountSid);
        secure(operatedAccount, "RestComm:Read:Recordings");
        final Recording recording = dao.getRecording(new Sid(sid));
        if (recording == null) {
            return status(NOT_FOUND).build();
        } else {
            secure(operatedAccount, recording.getAccountSid(), SecuredType.SECURED_STANDARD);
            if (APPLICATION_JSON_TYPE == responseType) {
                return ok(gson.toJson(recording), APPLICATION_JSON).build();
            } else if (APPLICATION_XML_TYPE == responseType) {
                final RestCommResponse response = new RestCommResponse(recording);
                return ok(xstream.toXML(response), APPLICATION_XML).build();
            } else {
                return null;
            }
        }
    }

    protected Response getRecordings(final String accountSid, UriInfo info,final MediaType responseType) {
        secure(accountsDao.getAccount(accountSid), "RestComm:Read:Recordings");

        boolean localInstanceOnly = true;
        try {
            String localOnly = info.getQueryParameters().getFirst("localOnly");
            if (localOnly != null && localOnly.equalsIgnoreCase("false"))
                localInstanceOnly = false;
        } catch (Exception e) {
        }

        // shall we include sub-accounts cdrs in our query ?
        boolean querySubAccounts = false; // be default we don't
        String querySubAccountsParam = info.getQueryParameters().getFirst("SubAccounts");
        if (querySubAccountsParam != null && querySubAccountsParam.equalsIgnoreCase("true"))
            querySubAccounts = true;

        String pageSize = info.getQueryParameters().getFirst("PageSize");
        String page = info.getQueryParameters().getFirst("Page");
        String startTime = info.getQueryParameters().getFirst("StartTime");
        String endTime = info.getQueryParameters().getFirst("EndTime");
        String callSid = info.getQueryParameters().getFirst("CallSid");

        if (pageSize == null) {
            pageSize = "50";
        }

        if (page == null) {
            page = "0";
        }

        int limit = Integer.parseInt(pageSize);
        int offset = (page.equals("0")) ? 0 : (((Integer.parseInt(page) - 1) * Integer.parseInt(pageSize)) + Integer
                .parseInt(pageSize));

        // Shall we query cdrs of sub-accounts too ?
        // if we do, we need to find the sub-accounts involved first
        List<String> ownerAccounts = null;
        if (querySubAccounts) {
            ownerAccounts = new ArrayList<String>();
            ownerAccounts.add(accountSid); // we will also return parent account cdrs
            ownerAccounts.addAll(accountsDao.getSubAccountSidsRecursive(new Sid(accountSid)));
        }

        RecordingFilter filterForTotal;

        try {

            if (localInstanceOnly) {
                filterForTotal = new RecordingFilter(accountSid, ownerAccounts, startTime, endTime, callSid,
                        null, null);
            } else {
                filterForTotal = new RecordingFilter(accountSid, ownerAccounts, startTime, endTime, callSid,
                        null, null, instanceId);
            }
        } catch (ParseException e) {
            return status(BAD_REQUEST).build();
        }

        final int total = dao.getTotalRecording(filterForTotal);

        if (Integer.parseInt(page) > (total / limit)) {
            return status(javax.ws.rs.core.Response.Status.BAD_REQUEST).build();
        }

        RecordingFilter filter;

        try {
            if (localInstanceOnly) {
                filter = new RecordingFilter(accountSid, ownerAccounts, startTime, endTime, callSid,
                        limit, offset);
            } else {
                filter = new RecordingFilter(accountSid, ownerAccounts, startTime, endTime, callSid,
                        limit, offset, instanceId);
            }
        } catch (ParseException e) {
            return status(BAD_REQUEST).build();
        }

        final List<Recording> cdrs = dao.getRecordings(filter);

        listConverter.setCount(total);
        listConverter.setPage(Integer.parseInt(page));
        listConverter.setPageSize(Integer.parseInt(pageSize));
        listConverter.setPathUri(info.getRequestUri().getPath());

        if (APPLICATION_XML_TYPE == responseType) {
            final RestCommResponse response = new RestCommResponse(new RecordingList(cdrs));
            return ok(xstream.toXML(response), APPLICATION_XML).build();
        } else if (APPLICATION_JSON_TYPE == responseType) {
            return ok(gson.toJson(new RecordingList(cdrs)), APPLICATION_JSON).build();
        } else {
            return null;
        }
    }

    protected Response getRecordingsByCall(final String accountSid, final String callSid, final MediaType responseType) {
        secure(accountsDao.getAccount(accountSid), "RestComm:Read:Recordings");

        final List<Recording> recordings = dao.getRecordingsByCall(new Sid(callSid));
        if (APPLICATION_JSON_TYPE == responseType) {
            return ok(gson.toJson(recordings), APPLICATION_JSON).build();
        } else if (APPLICATION_XML_TYPE == responseType) {
            final RestCommResponse response = new RestCommResponse(new RecordingList(recordings));
            return ok(xstream.toXML(response), APPLICATION_XML).build();
        } else {
            return null;
        }
    }
}
